import fs from "fs";
import path from "path";

// The export's text renderer, lifted out of the /api/media-to-video handler so more
// than one caller can use it.
//
// It was ~550 lines of closures inside that handler, which is why a thumbnail could not
// reuse it, and why the alternatives were a second renderer or a native view-capture
// module. Both would have meant TWO definitions of what a caption looks like, and this
// project's history is a list of what happens when two definitions of one thing drift:
// the caption swatch and the canvas, captionMetrics and the caret, the app's line wrap
// and the server's.
//
// Moved VERBATIM. Every line of the render body is the code that was in the handler, so
// an export produces the same pixels it did before - verified by rendering the same
// overlays through the old code and the new and comparing the frames, not by reading
// the diff. The only changes are that values the handler had in scope (W, H, the export
// scale, the font map) are now arguments, and per-overlay progress is a callback.
//
// What deliberately did NOT move: the ffmpeg overlay chain that composites these PNGs
// into the video. That is the EXPORT's way of using the output - it pushes into the
// handler's own `inputs`/`filterParts` - and a thumbnail composites differently. Taking
// it too was the one mistake this move made; the boundary is that this module renders
// each overlay to a PNG and says where it goes, and the caller decides how to place it.
//
// Helpers are INJECTED rather than imported from server.js. That avoids a circular
// import, keeps this module independently testable, and means there is still exactly one
// definition of run / uniqueName / mapWithConcurrency / num / safeColor.
export function createTextRenderer({
  W, H,
  exportScale,
  uploadsDir,
  fontsDir,
  fontFileMap,
  run, uniqueName, mapWithConcurrency, num, safeColor,
  // Called after each overlay finishes. The export reports progress through it; a
  // thumbnail has one overlay and ignores it.
  onOverlayRendered = () => {},
}) {
  // Renders every overlay to its own transparent PNG and returns [{ t, outPng, placeX,
  // placeY }] - where each one goes, not what to do with it.
  async function render(textOverlays) {
    const FONT_FILE_MAP = fontFileMap;
    const FONTS_DIR = fontsDir;

    function wrapTextLinesServer(text, maxWordsPerLine = 4) {
      const words = (text || '').split(/\s+/).filter(Boolean);
      const lines = [];
      let current = [];
      for (const word of words) {
        current.push(word);
        if (current.length >= maxWordsPerLine) {
          lines.push(current.join(' '));
          current = [];
        }
      }
      if (current.length > 0) lines.push(current.join(' '));
      return lines.length > 0 ? lines : [''];
    }

    // Where a single word sits inside a rendered `label:`. The chip that follows
    // the voice has to be drawn behind one word of a phrase, and ImageMagick will
    // not report where a word landed - but it will measure any string, and a
    // label's internal padding is constant for a given font and size, so it
    // cancels in a difference:
    //
    //   x of word = W(prefix) - pad        width = W(prefix + word) - W(prefix)
    //
    // Checked against a render rather than reasoned about: the last word's right
    // edge lands exactly on the measured width of the whole phrase.
    const labelPadCache = new Map();

    // Cached. A highlight caption measures the same line once per word in it, and
    // the same words again for every still of that phrase - all identical calls.
    const labelWidthCache = new Map();
    const labelWidth = async (fontPath, pointsize, kerning, text) => {
      const wkey = `${fontPath}|${pointsize}|${kerning}|${text}`;
      if (labelWidthCache.has(wkey)) return labelWidthCache.get(wkey);
      const out = await run('convert', [
        '-background', 'none', '-fill', 'white',
        ...(fontPath ? ['-font', fontPath] : []),
        '-pointsize', pointsize,
        ...(kerning != null ? ['-kerning', kerning] : []),
        `label:${text}`, '-format', '%w', 'info:',
      ], { timeout: 15000 });
      const w = parseInt(String(out).trim(), 10) || 0;
      labelWidthCache.set(wkey, w);
      return w;
    };

    // The layers of a caption that do not depend on WHICH word is chipped.
    //
    // A highlight style arrives as one still per word, and every one of them was
    // rebuilding the whole stack: the mask, the alpha, the dilate, and a blurred
    // tint for each of shadow, glow and stroke. Measured at the real export size,
    // the dilate alone is 380ms and each blur about 360ms - so a four-word phrase
    // paid roughly 5.6 seconds to draw the same picture four times with the chip
    // in a different place. That is what made the export look hung.
    //
    // Keyed on everything that actually changes those layers. The chip's position
    // is not in the key, because it is composited on top of them.
    const phraseLayerCache = new Map();

    // pad = 2*W(c) - W(cc), for any c. Cached: it depends only on the font, the
    // size and the tracking, and a caption measures several words at each of them.
    const labelPad = async (fontPath, pointsize, kerning) => {
      const key = `${fontPath}|${pointsize}|${kerning}`;
      if (labelPadCache.has(key)) return labelPadCache.get(key);
      const one = await labelWidth(fontPath, pointsize, kerning, 'M');
      const two = await labelWidth(fontPath, pointsize, kerning, 'MM');
      const pad = Math.max(0, one * 2 - two);
      labelPadCache.set(key, pad);
      return pad;
    };

    const wordBoxInLabel = async ({ fontPath, pointsize, kerning, lines, wordIndex, Wt, Ht }) => {
      let remaining = wordIndex;
      let lineIndex = -1;
      let inLine = -1;
      for (let i = 0; i < lines.length; i++) {
        const n = lines[i].split(/\s+/).filter(Boolean).length;
        if (remaining < n) { lineIndex = i; inLine = remaining; break; }
        remaining -= n;
      }
      if (lineIndex < 0) return null;

      const words = lines[lineIndex].split(/\s+/).filter(Boolean);
      const pad = await labelPad(fontPath, pointsize, kerning);
      const lineW = (await labelWidth(fontPath, pointsize, kerning, lines[lineIndex])) - pad;
      const prefixW = inLine === 0
        ? 0
        : (await labelWidth(fontPath, pointsize, kerning, words.slice(0, inLine).join(' ') + ' ')) - pad;
      const uptoW = (await labelWidth(fontPath, pointsize, kerning, words.slice(0, inLine + 1).join(' '))) - pad;

      // Lines are centred within the label, so a short line starts inset by half
      // the difference rather than at zero.
      const lineH = Ht / lines.length;
      return {
        x: (Wt - lineW) / 2 + prefixW,
        y: lineIndex * lineH,
        w: Math.max(1, uptoW - prefixW),
        h: lineH,
      };
    };

    // Real-width wrap, for the one kind of overlay that actually specifies a
    // width: a manual text overlay resized with the app's side handles
    // (boxWidthPercent). wrapTextLinesServer's fixed word count is a fine
    // approximation for auto-captions, which never carry this field, but a
    // dragged box has a real target width, and the app's own preview already
    // reflows to it - this is what makes the export agree, using the same
    // labelWidth() the highlight chip's word-boxing already measures with.
    // A single word wider than targetWidthPx on its own still gets its own
    // line rather than being split mid-word - the app's Text component does
    // the same, so the two stay consistent at that edge too.
    const wrapTextLinesByWidth = async (text, fontPath, pointsize, kerning, targetWidthPx) => {
      const words = (text || '').split(/\s+/).filter(Boolean);
      if (words.length === 0) return [''];
      const lines = [];
      let current = [];
      for (const word of words) {
        const candidate = current.concat(word).join(' ');
        const w = await labelWidth(fontPath, pointsize, kerning, candidate);
        if (current.length > 0 && w > targetWidthPx) {
          lines.push(current.join(' '));
          current = [word];
        } else {
          current.push(word);
        }
      }
      if (current.length > 0) lines.push(current.join(' '));
      return lines.length > 0 ? lines : [''];
    };

    const EXPORT_SCALE = exportScale;
    const renderedTextPngs = [];

    let overlaysRendered = 0;
    // Grouped by phrase before anything runs, not just batched blindly -
    // phraseLayerCache (below) only writes the shared shadow/glow/stroke
    // layers back once a word finishes, so two words of the SAME phrase
    // running at the same time would both miss the cache and both pay the
    // dilate/blur cost that cache exists specifically to avoid (identical
    // for every word of a phrase, per the comment on it) - real wasted CPU,
    // not just a missed optimisation. A highlight style's per-word overlays
    // all carry the identical text/font/size/spec of their shared phrase
    // (only activeWord differs), so grouping on that tuple keeps every
    // phrase's own words sequential - the cache still helps exactly as it
    // did before - while different phrases (or ordinary non-highlight
    // overlays, one to a group) run concurrently with each other.
    // Each overlay carries the index it arrived at, because the results are SORTED BACK
    // into that order before being returned. Grouping reorders, and the groups then run
    // concurrently, so without this `renderedTextPngs` comes out in COMPLETION order -
    // which the caller turns into a chain of ffmpeg overlay filters, where later means
    // on top. Stacking order was therefore decided by which `convert` finished first.
    //
    // Mostly invisible, because overlays rarely sit on top of one another and a
    // highlight caption's words never do. Not invisible at all once anything lets a
    // user say which overlay is in front.
    const phraseGroups = new Map();
    textOverlays.forEach((t, sourceIndex) => {
      const groupKey = JSON.stringify([t.text, t.font, t.size, t.captionSpec || null]);
      if (!phraseGroups.has(groupKey)) phraseGroups.set(groupKey, []);
      phraseGroups.get(groupKey).push({ t, sourceIndex });
    });
    // Bounded concurrency, not one at a time: a highlight-style caption
    // sends one overlay per spoken word, so a normal-length voiceover can
    // mean hundreds of these, each several `convert` process-spawns on top
    // of its own actual image work. Overlapping that spawn overhead
    // instead of paying it fully sequentially - the per-overlay logic
    // below is completely unchanged, only when each one starts is
    // different. Set to this VPS's real core count (`nproc` = 6), not
    // guessed: benchmarked the actual mask/alpha/dilate/composite chain
    // this loop runs, live, with the box's other pm2 processes already
    // running - 1/4/6/8/12 gave 208/41/29/36/29 ms per overlay. 6 beat 4
    // by ~30%; 8 was worse than 6 (contention past the real core count);
    // 12 matched 6 with no further gain. Revisit if this VPS's core count
    // or its other workload changes.
    const OVERLAY_CONCURRENCY = 6;
    await mapWithConcurrency(Array.from(phraseGroups.values()), OVERLAY_CONCURRENCY, async (group) => {
    for (const { t, sourceIndex } of group) {
      const isGradient = Array.isArray(t.gradient) && t.gradient.length >= 2;
      const fontFileName = FONT_FILE_MAP[t.font];
      const fontPath = fontFileName ? path.join(FONTS_DIR, fontFileName) : null;
      const fontArg = fontPath ? `-font "${fontPath}"` : '';
      const fontSizePx = Math.round((t.size || 18) * EXPORT_SCALE);
      // A caption style arrives as a spec of typographic parts - stroke, glow,
      // shadow, box, tracking - rather than an id this file has to recognise, so
      // a style added to the app's catalogue renders here without a deploy on
      // this side. Overlays made before the catalogue existed carry no spec and
      // fall through to the old id-keyed behaviour below.
      const spec = (t.captionSpec && typeof t.captionSpec === 'object') ? t.captionSpec : null;
      // Every length in a spec is points at the app's 18pt caption base.
      const sscale = fontSizePx / 18;
      // boxWidthPercent is only ever present on a manual overlay the app's
      // side handles resized - everything else (every auto-caption, every
      // overlay nobody has dragged) keeps the word-count wrap unchanged.
      const wrapKerning = spec && spec.spacing ? (num(spec.spacing) * sscale).toFixed(2) : null;
      const lines = Number.isFinite(Number(t.boxWidthPercent))
        ? await wrapTextLinesByWidth(
            t.text, fontPath, Math.max(1, Math.round(fontSizePx)), wrapKerning,
            (Number(t.boxWidthPercent) / 100) * W,
          )
        : wrapTextLinesServer(t.text, 4);
      const multilineText = lines.join('\n');
      // Only the backslash needs removing (ImageMagick escape syntax). Quotes
      // used to be rewritten to apostrophes to survive the shell; with execFile
      // they render as the user typed them.
      const safeText = multilineText.replace(/\\/g, '');

      const base = path.join(uploadsDir, uniqueName('txtrender', 'png'));
      const maskPng = base.replace('.png', '_mask.png');
      const alphaPng = base.replace('.png', '_alpha.png');
      const fillPng = base.replace('.png', '_fill.png');
      const coloredPng = base.replace('.png', '_colored.png');
      const outPng = base;

      // Overlays the editor can rotate and scale carry their CENTRE as x/y, since
      // a top-left corner is not a position you can turn something about - spin an
      // element and the corner describes a circle while the thing being aimed
      // stays put. Older clients send a top-left and are placed the old way.
      const centreAnchored = t.anchor === 'center';
      const gravityArg = (centreAnchored || t.isAutoCaption) ? 'Center' : 'West';
      await run('convert', [
        '-background', 'none', '-fill', 'white',
        ...(fontPath ? ['-font', fontPath] : []),
        '-pointsize', Math.max(1, Math.round(fontSizePx)),
        // Tracking has to go on here rather than at composite time - it changes
        // the glyph positions, and every layer below is cut from this one mask.
        ...(spec && spec.spacing ? ['-kerning', (num(spec.spacing) * sscale).toFixed(2)] : []),
        '-gravity', gravityArg,
        `label:${safeText}`,
        maskPng,
      ]).catch(e => { console.error('Text mask render error:', e.stderr?.slice(-500) || e.message); throw new Error('Text mask render failed'); });

      await run('convert', [maskPng, '-alpha', 'extract', alphaPng])
        .catch(e => { console.error('Alpha extract error:', e.stderr?.slice(-500) || e.message); throw new Error('Alpha extract failed'); });

      const { Wt, Ht } = await run('identify', ['-format', '%w %h', maskPng], { timeout: 15000 })
        .then(out => { const p = out.trim().split(' ').map(Number); return { Wt: p[0], Ht: p[1] }; })
        .catch(() => { throw new Error('identify failed'); });

      // Which word this overlay is showing as spoken. The client sends one overlay
      // per word for a highlight style - the phrase is on screen throughout, but
      // which word is chipped changes within it, and an overlay is one still.
      const hlCfg = spec && spec.highlight ? spec.highlight : null;
      const hlIndex = Number.isInteger(t.activeWord) ? t.activeWord : -1;
      const hlKerning = spec && spec.spacing ? (num(spec.spacing) * sscale).toFixed(2) : null;
      let wordBox = null;
      if (hlCfg && hlIndex >= 0) {
        // A phrase that cannot be measured still has to render. Losing the chip
        // is a worse caption; losing the caption is a broken video.
        wordBox = await wordBoxInLabel({
          fontPath, pointsize: Math.max(1, Math.round(fontSizePx)), kerning: hlKerning,
          lines, wordIndex: hlIndex, Wt, Ht,
        }).catch(e => {
          console.error('Word box measure failed, drawing caption without chip:', e.message);
          return null;
        });
      }

      if (isGradient) {
        const g0 = safeColor(t.gradient[0]);
        const g1 = safeColor(t.gradient[1]);
        await run('convert', ['-size', `${Wt}x${Ht}`, '-define', 'gradient:direction=East', `gradient:${g0}-${g1}`, fillPng])
          .catch(e => { console.error('Gradient fill error:', e.stderr?.slice(-500) || e.message); throw new Error('Gradient fill failed'); });
      } else {
        const fillArgs = ['-size', `${Wt}x${Ht}`, `xc:${safeColor(t.color)}`];
        // The spoken word is recoloured by painting its box into the fill before
        // the glyph alpha is applied, so only the letters take the new colour -
        // the rectangle itself never survives the CopyOpacity below.
        if (wordBox && hlCfg.textColor) {
          fillArgs.push(
            '-fill', safeColor(hlCfg.textColor, '#000000'),
            '-draw', `rectangle ${Math.round(wordBox.x)},${Math.round(wordBox.y)} `
              + `${Math.round(wordBox.x + wordBox.w)},${Math.round(wordBox.y + wordBox.h)}`,
          );
        }
        fillArgs.push(fillPng);
        await run('convert', fillArgs)
          .catch(e => { console.error('Flat fill error:', e.stderr?.slice(-500) || e.message); throw new Error('Flat fill failed'); });
      }

      await run('convert', [fillPng, alphaPng, '-alpha', 'off', '-compose', 'CopyOpacity', '-composite', coloredPng])
        .catch(e => { console.error('CopyOpacity composite error:', e.stderr?.slice(-500) || e.message); throw new Error('Composite failed'); });

      let effWt = Wt, effHt = Ht;

      // Overlays with no spec: the two id-keyed looks this file used to know,
      // plus the plain drop shadow everything else got.
      const LEGACY_SHADOW = {
        shadow3d: { color: '#555555', dx: 6, dy: 6, radius: 0 },
        neon: { color: safeColor(t.color, '#7FFF00'), dx: 0, dy: 0, radius: 6 },
      };
      const legacyWantsShadow = t.isAutoCaption && t.captionShadow !== false
        && !LEGACY_SHADOW[t.captionStyleId] && t.captionStyleId !== 'sticker' && t.captionStyleId !== 'outline';
      const shadowCfg = spec
        ? (spec.shadow ? {
            color: spec.shadow.color,
            dx: num(spec.shadow.dx) * sscale,
            dy: num(spec.shadow.dy) * sscale,
            radius: num(spec.shadow.radius) * sscale,
          } : null)
        : (LEGACY_SHADOW[t.captionStyleId] || (legacyWantsShadow ? { color: '#000000', dx: 2, dy: 2, radius: 2 } : null));
      const glowCfg = spec && spec.glow
        ? { color: spec.glow.color, radius: Math.max(1, num(spec.glow.radius, 8) * sscale) }
        : null;
      // The ring reaches `width` beyond the glyph edge - the same measure the app
      // gets from eight copies offset around the fill, so the two agree.
      const strokeR = spec && spec.stroke ? Math.max(0.5, num(spec.stroke.width) * sscale) : 0;

      // A chip enters the layered path even with nothing else to stack, because it
      // needs the same margin: drawn on a canvas cropped to the glyphs, its own
      // padding would be clipped off at the edges of the first and last word.
      const hlPadX = wordBox ? num(hlCfg.padX) * sscale : 0;
      const hlPadY = wordBox ? num(hlCfg.padY) * sscale : 0;

      if (shadowCfg || glowCfg || strokeR > 0 || wordBox) {
        const pad = Math.max(
          Math.ceil(Math.max(hlPadX, hlPadY)) + 2,
          Math.ceil(
            strokeR
            + (glowCfg ? glowCfg.radius * 3 : 0)
            + (shadowCfg ? shadowCfg.radius * 3 + Math.max(Math.abs(shadowCfg.dx), Math.abs(shadowCfg.dy)) : 0)
            + 6
          )
        );
        const paddedW = Wt + pad * 2;
        const paddedH = Ht + pad * 2;
        const combinedPng = base.replace('.png', '_combined.png');
        const alphaPadPng = base.replace('.png', '_alphapad.png');
        // Everything below is shared by every still of this phrase; only the chip's
        // position differs. Files in the cache must outlive the overlay that made
        // them, so they are kept out of `scratch` and swept at the end of the job.
        const layerKey = JSON.stringify([
          safeText, fontPath, Math.round(fontSizePx),
          spec && spec.spacing ? num(spec.spacing) : 0,
          spec && spec.stroke ? [spec.stroke.color, num(spec.stroke.width)] : 0,
          spec && spec.glow ? [spec.glow.color, num(spec.glow.radius)] : 0,
          spec && spec.shadow ? [spec.shadow.color, num(spec.shadow.radius), num(spec.shadow.dx), num(spec.shadow.dy)] : 0,
          paddedW, paddedH, pad, gravityArg,
        ]);
        const cachedLayers = phraseLayerCache.get(layerKey) || null;
        const layers = cachedLayers || {};
        // alphaPadPng is cached and reused by the next word, so it must NOT be in
        // scratch - it would be deleted at the end of this still and the next one
        // would dilate a file that is gone. Only genuinely per-word files go here.
        const scratch = [];

        // The pad goes on before the dilate, not after: dilating an alpha cropped
        // to the glyphs squares the ring off at the text's bounding box, which
        // reads as a black slab behind the word rather than an outline round it.
        if (!cachedLayers) await run('convert', [alphaPng, '-bordercolor', 'black', '-border', pad, alphaPadPng])
          .catch(e => { console.error('Alpha pad error:', e.stderr?.slice(-500) || e.message); throw new Error('Alpha pad failed'); });

        let ringPng = layers.alphaPadPng || alphaPadPng;
        if (strokeR > 0) {
          if (cachedLayers) {
            ringPng = layers.ringPng;
          } else {
            ringPng = base.replace('.png', '_ring.png');
            // The single most expensive call in the whole caption path - 380ms at
            // export size - and identical for every word of a phrase.
            await run('convert', [alphaPadPng, '-morphology', 'Dilate', 'Disk:' + strokeR.toFixed(2), ringPng])
              .catch(e => { console.error('Stroke dilate error:', e.stderr?.slice(-500) || e.message); throw new Error('Stroke dilate failed'); });
            layers.ringPng = ringPng;
          }
        }
        if (!cachedLayers) layers.alphaPadPng = alphaPadPng;

        // A flat colour cut to a silhouette by the given mask, optionally blurred.
        const tint = async (colour, maskPath, outPath, blur) => {
          const src = outPath.replace('.png', '_src.png');
          await run('convert', ['-size', `${paddedW}x${paddedH}`, `xc:${safeColor(colour, '#000000')}`, src]);
          await run('convert', [src, maskPath, '-alpha', 'off', '-compose', 'CopyOpacity', '-composite', outPath]);
          if (blur > 0) await run('convert', [outPath, '-blur', `0x${blur.toFixed(2)}`, outPath]);
          try { fs.unlinkSync(src); } catch (e) {}
        };
        // ImageMagick reads "+-3+0" as malformed rather than as a negative offset.
        const geo = (x, y) => `${x >= 0 ? '+' : ''}${Math.round(x)}${y >= 0 ? '+' : ''}${Math.round(y)}`;

        const args = ['-size', `${paddedW}x${paddedH}`, 'xc:none'];

        // First, so it sits under everything - as it does in the app. Painted over
        // the stroke instead, the chip would swallow the outline of the very word
        // it is meant to sit behind.
        if (wordBox) {
          const chipPng = base.replace('.png', '_chip.png');
          scratch.push(chipPng);
          const x0 = Math.round(pad + wordBox.x - hlPadX);
          const y0 = Math.round(pad + wordBox.y - hlPadY);
          const x1 = Math.round(pad + wordBox.x + wordBox.w + hlPadX);
          const y1 = Math.round(pad + wordBox.y + wordBox.h + hlPadY);
          const radius = Math.max(0, Math.min(
            Math.round(num(hlCfg.radius, 0) * sscale),
            Math.floor(Math.min(x1 - x0, y1 - y0) / 2)
          ));
          // A roundrectangle of radius 0 draws nothing at all - not a
          // square-cornered box, nothing - so a hard-edged chip asks for a
          // rectangle by name. The app's chip is square, so this is the usual case.
          const draw = radius >= 1
            ? `roundrectangle ${x0},${y0} ${x1},${y1} ${radius},${radius}`
            : `rectangle ${x0},${y0} ${x1},${y1}`;
          await run('convert', [
            '-size', `${paddedW}x${paddedH}`, 'xc:none',
            '-fill', safeColor(hlCfg.color, '#FFE24A'),
            '-draw', draw,
            chipPng,
          ]).catch(e => { console.error('Chip draw error:', e.stderr?.slice(-500) || e.message); throw new Error('Chip draw failed'); });
          args.push(chipPng, '-geometry', '+0+0', '-composite');
        }

        if (shadowCfg) {
          const shadowPng = layers.shadowPng || base.replace('.png', '_shadow.png');
          if (!layers.shadowPng) await tint(shadowCfg.color, ringPng, shadowPng, shadowCfg.radius)
            .catch(e => { console.error('Shadow layer error:', e.stderr?.slice(-500) || e.message); throw new Error('Shadow layer failed'); });
          layers.shadowPng = shadowPng;
          args.push(shadowPng, '-geometry', geo(shadowCfg.dx, shadowCfg.dy), '-composite');
        }

        if (glowCfg) {
          const glowPng = layers.glowPng || base.replace('.png', '_glow.png');
          if (!layers.glowPng) await tint(glowCfg.color, ringPng, glowPng, glowCfg.radius)
            .catch(e => { console.error('Glow layer error:', e.stderr?.slice(-500) || e.message); throw new Error('Glow layer failed'); });
          // Laid down twice, as the app does: stacking the same halo reads brighter,
          // where one pass at a wider radius only spreads the same ink thinner.
          layers.glowPng = glowPng;
          args.push(glowPng, '-geometry', '+0+0', '-composite');
          args.push(glowPng, '-geometry', '+0+0', '-composite');
        }

        if (strokeR > 0) {
          const strokePng = layers.strokePng || base.replace('.png', '_stroke.png');
          if (!layers.strokePng) await tint(spec.stroke.color, ringPng, strokePng, 0)
            .catch(e => { console.error('Stroke layer error:', e.stderr?.slice(-500) || e.message); throw new Error('Stroke layer failed'); });
          layers.strokePng = strokePng;
          args.push(strokePng, '-geometry', '+0+0', '-composite');
        }

        args.push(coloredPng, '-geometry', `+${pad}+${pad}`, '-composite', combinedPng);
        await run('convert', args)
          .catch(e => { console.error('Layer combine error:', e.stderr?.slice(-500) || e.message); throw new Error('Layer combine failed'); });

        try { fs.unlinkSync(coloredPng); } catch (e) {}
        fs.copyFileSync(combinedPng, coloredPng);
        try { fs.unlinkSync(combinedPng); } catch (e) {}
        // Kept for the next still of this phrase. `scratch` holds only the files
        // that are genuinely per-word, so this cannot delete something still needed.
        phraseLayerCache.set(layerKey, layers);
        scratch.forEach(f => { try { fs.unlinkSync(f); } catch (e) {} });
        effWt = paddedW;
        effHt = paddedH;
      }

      // The chip is drawn last so it sits behind the finished stack, and hugs it
      // rather than the caption's full column width.
      if (spec && spec.box) {
        const padX = Math.round(num(spec.box.padX) * sscale);
        const padY = Math.round(num(spec.box.padY) * sscale);
        const boxW = effWt + padX * 2;
        const boxH = effHt + padY * 2;
        // A pill is written as a radius larger than the chip; clamp it to what a
        // rounded rectangle can actually be before ImageMagick draws nothing.
        const radius = Math.max(0, Math.min(
          Math.round(num(spec.box.radius) * sscale),
          Math.floor(Math.min(boxW, boxH) / 2)
        ));
        const boxPng = base.replace('.png', '_box.png');
        const boxedPng = base.replace('.png', '_boxed.png');
        // A roundrectangle of radius 0 draws nothing at all - not a square-cornered
        // box, nothing - so a hard-edged chip has to ask for a rectangle by name.
        const boxDraw = radius >= 1
          ? `roundrectangle 0,0 ${boxW - 1},${boxH - 1} ${radius},${radius}`
          : `rectangle 0,0 ${boxW - 1},${boxH - 1}`;
        await run('convert', [
          '-size', `${boxW}x${boxH}`, 'xc:none',
          '-fill', safeColor(spec.box.color, '#000000'),
          '-draw', boxDraw,
          boxPng,
        ]).catch(e => { console.error('Box draw error:', e.stderr?.slice(-500) || e.message); throw new Error('Box draw failed'); });
        await run('convert', [boxPng, coloredPng, '-geometry', `+${padX}+${padY}`, '-composite', boxedPng])
          .catch(e => { console.error('Box composite error:', e.stderr?.slice(-500) || e.message); throw new Error('Box composite failed'); });
        try { fs.unlinkSync(coloredPng); } catch (e) {}
        fs.copyFileSync(boxedPng, coloredPng);
        try { fs.unlinkSync(boxedPng); } catch (e) {}
        try { fs.unlinkSync(boxPng); } catch (e) {}
        effWt = boxW;
        effHt = boxH;
      }

      const rotationDeg = num(t.rotation, 0);
      let WR = effWt, HR = effHt;
      if (Math.abs(rotationDeg) > 0.01) {
        await run('convert', [coloredPng, '-background', 'none', '-rotate', rotationDeg, outPng])
          .catch(e => { console.error('Rotate error:', e.stderr?.slice(-500) || e.message); throw new Error('Rotate failed'); });
        const rotDim = await run('identify', ['-format', '%w %h', outPng], { timeout: 15000 })
          .then(out => { const p = out.trim().split(' ').map(Number); return { w: p[0], h: p[1] }; })
          .catch(() => { throw new Error('identify rotated failed'); });
        WR = rotDim.w; HR = rotDim.h;
        try { fs.unlinkSync(coloredPng); } catch (e) {}
      } else {
        fs.copyFileSync(coloredPng, outPng);
        try { fs.unlinkSync(coloredPng); } catch (e) {}
      }

      // No overlay may be placed, or sized, such that any part of it lands
      // outside the exported frame. A user can drag an overlay near a frame
      // edge, pinch it up to 6x, or land on a caption whose wrapped lines
      // run wide at this font/size - every one of those is invisible in
      // the small in-app preview (which merely clips it via
      // overflow:hidden) and only shows up as a cropped word in the file.
      // EDGE_MARGIN mirrors CanvasOverlay's own EDGE_MARGIN=8 in the app,
      // scaled to this export's resolution, so the safe zone agrees with
      // the one the drag gesture already respects on-screen.
      const EDGE_MARGIN = Math.round(8 * EXPORT_SCALE);
      const maxW = Math.max(1, W - 2 * EDGE_MARGIN);
      const maxH = Math.max(1, H - 2 * EDGE_MARGIN);
      if (WR > maxW || HR > maxH) {
        const fitScale = Math.min(maxW / WR, maxH / HR);
        const newW = Math.max(1, Math.round(WR * fitScale));
        const newH = Math.max(1, Math.round(HR * fitScale));
        await run('convert', [outPng, '-resize', `${newW}x${newH}!`, outPng])
          .catch(e => { console.error('Fit-to-frame resize error:', e.stderr?.slice(-500) || e.message); throw new Error('Fit-to-frame resize failed'); });
        WR = newW; HR = newH;
      }

      const centerX = centreAnchored
        ? ((t.x ?? 50) / 100) * W
        : (t.isAutoCaption ? (W / 2) : (((t.x ?? 50) / 100) * W + Wt / 2));
      const centerY = centreAnchored
        ? ((t.y ?? 80) / 100) * H
        : (((t.y ?? 80) / 100) * H + effHt / 2);
      // The resize above guarantees WR <= maxW and HR <= maxH, so
      // `W - EDGE_MARGIN - WR` is always >= EDGE_MARGIN - this clamp can
      // never invert into an empty range.
      const placeX = Math.min(Math.max(Math.round(centerX - WR / 2), EDGE_MARGIN), W - EDGE_MARGIN - WR);
      const placeY = Math.min(Math.max(Math.round(centerY - HR / 2), EDGE_MARGIN), H - EDGE_MARGIN - HR);

      renderedTextPngs.push({ t, outPng, placeX, placeY, sourceIndex });

      try { fs.unlinkSync(maskPng); } catch (e) {}
      try { fs.unlinkSync(alphaPng); } catch (e) {}
      try { fs.unlinkSync(fillPng); } catch (e) {}

      // This loop is the one span between 60% and 80% with no progress
      // reporting at all, regardless of how many overlays there are or how
      // long each one takes - a project with several overlays (this file's
      // own mask/alpha/fill/composite chain per overlay, several `convert`
      // shell-outs each) could sit on "60% Adding text & overlays..." for
      // minutes with the bar never moving, reading as hung even when the
      // job is actively working. Reported here rather than only at the
      // end, so the number the client polls actually reflects progress
      // through this specific loop, not just the stage before and after it.
      overlaysRendered += 1;
      onOverlayRendered(overlaysRendered, textOverlays.length);
    }
    });

    // The cached phrase layers have outlived their usefulness now every still is
    // rendered. Without this they would accumulate in uploads/ for the life of the
    // process - one dilate and three blurred tints per distinct caption.
    for (const l of phraseLayerCache.values()) {
      for (const f of Object.values(l)) { try { fs.unlinkSync(f); } catch (e) {} }
    }
    phraseLayerCache.clear();
    // Back into the order they were given in, so the caller's overlay chain stacks them
    // the way the app listed them rather than the way the CPU finished them.
    renderedTextPngs.sort((a, b) => a.sourceIndex - b.sourceIndex);
    return renderedTextPngs;
  }

  return { render };
}
