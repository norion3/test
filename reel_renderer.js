/**
 * リール描画モジュール (reel_renderer.js)
 * 確実な初期化時安全取得・白枠透過・赤7/BAR 105%限界拡大描画・7セグLED描画
 */

(function() {
  const SYMBOL_HEIGHT = 46;
  const CANVAS_WIDTH = 100;
  const symbolCache = {};

  const ReelRenderer = {
    // 105%限界拡大描画対応キャンバスカッシュ初期化 (typeof安全保護とwindow参照をinitSymbolCache内に配置し確実取得)
    initSymbolCache: function() {
      const drawFuncs = {
        '7': typeof drawSymbol7 !== 'undefined' ? drawSymbol7 : (typeof window.drawSymbol7 !== 'undefined' ? window.drawSymbol7 : null),
        'BAR': typeof drawSymbolBAR !== 'undefined' ? drawSymbolBAR : (typeof window.drawSymbolBAR !== 'undefined' ? window.drawSymbolBAR : null),
        'GRAPE': typeof drawSymbolGRAPE !== 'undefined' ? drawSymbolGRAPE : (typeof window.drawSymbolGRAPE !== 'undefined' ? window.drawSymbolGRAPE : null),
        'CHERRY': typeof drawSymbolCHERRY !== 'undefined' ? drawSymbolCHERRY : (typeof window.drawSymbolCHERRY !== 'undefined' ? window.drawSymbolCHERRY : null),
        'BELL': typeof drawSymbolBELL !== 'undefined' ? drawSymbolBELL : (typeof window.drawSymbolBELL !== 'undefined' ? window.drawSymbolBELL : null),
        'RHINO': typeof drawSymbolRHINO !== 'undefined' ? drawSymbolRHINO : (typeof window.drawSymbolRHINO !== 'undefined' ? window.drawSymbolRHINO : null),
        'CLOWN': typeof drawSymbolCLOWN !== 'undefined' ? drawSymbolCLOWN : (typeof window.drawSymbolCLOWN !== 'undefined' ? window.drawSymbolCLOWN : null)
      };

      Object.keys(drawFuncs).forEach(key => {
        const drawFn = drawFuncs[key];
        if (typeof drawFn !== 'function') return;

        const offscreen = document.createElement('canvas');
        offscreen.width = CANVAS_WIDTH;
        offscreen.height = SYMBOL_HEIGHT;
        const ctx = offscreen.getContext('2d');

        // 白枠を限界まで削ぎ落とし赤7/BARの縦サイズを最大化（105%スケール）
        if (key === '7' || key === 'BAR') {
          ctx.save();
          ctx.translate(CANVAS_WIDTH / 2, SYMBOL_HEIGHT / 2);
          ctx.scale(1.05, 1.05);
          ctx.translate(-CANVAS_WIDTH / 2, -SYMBOL_HEIGHT / 2);
          drawFn(ctx, 0, 0, CANVAS_WIDTH, SYMBOL_HEIGHT);
          ctx.restore();
        } else {
          drawFn(ctx, 0, 0, CANVAS_WIDTH, SYMBOL_HEIGHT);
        }

        symbolCache[key] = offscreen;
      });
    },

    // リールキャンバス描画（回転中ブラー効果 ＆ 通常静止描画）
    renderReelCanvas: function(reel, isSpinning) {
      if (!reel || !reel.ctx || !reel.strip) return;
      const ctx = reel.ctx;
      const strip = reel.strip;
      const totalSyms = strip.length;
      const fullHeight = SYMBOL_HEIGHT * totalSyms * 3;

      ctx.clearRect(0, 0, CANVAS_WIDTH, fullHeight);

      // パフォーマンス最適化のため3周期分を描画
      for (let pass = 0; pass < 3; pass++) {
        for (let i = 0; i < totalSyms; i++) {
          const symName = strip[i];
          const y = (pass * totalSyms + i) * SYMBOL_HEIGHT;
          const cachedImg = symbolCache[symName];

          if (cachedImg) {
            if (isSpinning) {
              ctx.save();
              ctx.globalAlpha = 0.85;
              ctx.drawImage(cachedImg, 0, y);
              ctx.restore();
            } else {
              ctx.drawImage(cachedImg, 0, y);
            }
          }
        }
      }
    },

    // 7セグメントLED更新処理
    update7SegDisplay: function(containerId, value, digitCount) {
      const container = document.getElementById(containerId);
      if (!container) return;
      const digits = container.querySelectorAll('.digit7seg');
      const valStr = String(value).padStart(digitCount, ' ');

      const SEG_MAP = {
        '0': ['a','b','c','d','e','f'],
        '1': ['b','c'],
        '2': ['a','b','d','e','g'],
        '3': ['a','b','c','d','g'],
        '4': ['b','c','f','g'],
        '5': ['a','c','d','f','g'],
        '6': ['a','c','d','e','f','g'],
        '7': ['a','b','c','f'],
        '8': ['a','b','c','d','e','f','g'],
        '9': ['a','b','c','d','f','g'],
        '-': ['g'],
        ' ': []
      };

      for (let i = 0; i < digitCount; i++) {
        if (!digits[i]) continue;
        const char = valStr[i] || ' ';
        const activeSegs = SEG_MAP[char] || [];
        const segElements = digits[i].querySelectorAll('.seg');

        segElements.forEach(seg => {
          const segClass = Array.from(seg.classList).find(c => c.startsWith('seg-'));
          if (segClass) {
            const segName = segClass.replace('seg-', '');
            if (activeSegs.includes(segName)) {
              seg.classList.add('lit');
            } else {
              seg.classList.remove('lit');
            }
          }
        });
      }
    }
  };

  window.REEL_RENDERER = ReelRenderer;
})();

