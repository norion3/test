/**
 * リール描画モジュール (reel_renderer.js)
 * 真因であったキャッシュシステムを全廃し、元のダイレクト描画方式を完全復活。
 * 白枠透過・赤7/BAR 105%限界拡大描画・7セグLED描画機能は維持。
 */

(function() {
  const SYMBOL_HEIGHT = 46;
  const CANVAS_WIDTH = 100;

  // 実行時に安全に各図柄の描画関数を取得する
  function getDrawFunc(symName) {
    try {
      if (symName === '7' && typeof drawSymbol7 !== 'undefined') return drawSymbol7;
      if (symName === 'BAR' && typeof drawSymbolBAR !== 'undefined') return drawSymbolBAR;
      if (symName === 'GRAPE' && typeof drawSymbolGRAPE !== 'undefined') return drawSymbolGRAPE;
      if (symName === 'CHERRY' && typeof drawSymbolCHERRY !== 'undefined') return drawSymbolCHERRY;
      if (symName === 'BELL' && typeof drawSymbolBELL !== 'undefined') return drawSymbolBELL;
      if (symName === 'RHINO' && typeof drawSymbolRHINO !== 'undefined') return drawSymbolRHINO;
      if (symName === 'CLOWN' && typeof drawSymbolCLOWN !== 'undefined') return drawSymbolCLOWN;
      
      // フォールバック
      if (typeof window !== 'undefined') {
        return window['drawSymbol' + symName] || null;
      }
    } catch(e) {}
    return null;
  }

  const ReelRenderer = {
    // キャッシュシステムは廃止したため、ここでは何もしない（エラー防止のため関数のみ残す）
    initSymbolCache: function() {},

    // リールキャンバス描画（元のダイレクト描画方式を完全復活）
    renderReelCanvas: function(reel, isSpinning) {
      if (!reel || !reel.ctx || !reel.strip) return;
      const ctx = reel.ctx;
      const strip = reel.strip;
      const totalSyms = strip.length;
      const fullHeight = SYMBOL_HEIGHT * totalSyms * 3;

      ctx.clearRect(0, 0, CANVAS_WIDTH, fullHeight);

      // 3周期分を描画
      for (let pass = 0; pass < 3; pass++) {
        for (let i = 0; i < totalSyms; i++) {
          const symName = strip[i];
          const y = (pass * totalSyms + i) * SYMBOL_HEIGHT;
          
          // その場で直接描画関数を取得
          const drawFn = getDrawFunc(symName);

          if (typeof drawFn === 'function') {
            ctx.save();
            
            // 回転中のブラー効果
            if (isSpinning) {
              ctx.globalAlpha = 0.85;
            }

            // 赤7/BAR 105%限界拡大描画
            if (symName === '7' || symName === 'BAR') {
              ctx.translate(CANVAS_WIDTH / 2, y + SYMBOL_HEIGHT / 2);
              ctx.scale(1.05, 1.05);
              ctx.translate(-CANVAS_WIDTH / 2, -(y + SYMBOL_HEIGHT / 2));
              // y座標は元の位置に描画させる
              drawFn(ctx, 0, y, CANVAS_WIDTH, SYMBOL_HEIGHT);
            } else {
              // 通常図柄の直接描画
              drawFn(ctx, 0, y, CANVAS_WIDTH, SYMBOL_HEIGHT);
            }
            
            ctx.restore();
          }
        }
      }
    },

    // 7セグメントLED更新処理（正常維持）
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


