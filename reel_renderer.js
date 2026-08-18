/**
 * リール描画モジュール (reel_renderer.js)
 * 表示窓固定(Viewport)ダイレクト描画・非同期画像ロード自動リスナー連動・白枠透過・赤7/BAR 105%限界拡大描画・7セグLED描画
 */

(function() {
  const SYMBOL_HEIGHT = 46;
  const CANVAS_WIDTH = 100;
  const VIEWPORT_HEIGHT = 138; // リール表示枠（高さ 138px）
  const symbolCache = {};

  // 外部 symbol_*.js の描画関数を安全取得
  function getDrawFunc(symName) {
    try {
      if (symName === '7' && typeof drawSymbol7 !== 'undefined') return drawSymbol7;
      if (symName === 'BAR' && typeof drawSymbolBAR !== 'undefined') return drawSymbolBAR;
      if (symName === 'GRAPE' && typeof drawSymbolGRAPE !== 'undefined') return drawSymbolGRAPE;
      if (symName === 'CHERRY' && typeof drawSymbolCHERRY !== 'undefined') return drawSymbolCHERRY;
      if (symName === 'BELL' && typeof drawSymbolBELL !== 'undefined') return drawSymbolBELL;
      if (symName === 'RHINO' && typeof drawSymbolRHINO !== 'undefined') return drawSymbolRHINO;
      if (symName === 'CLOWN' && typeof drawSymbolCLOWN !== 'undefined') return drawSymbolCLOWN;
      
      if (typeof window !== 'undefined') {
        return window['drawSymbol' + symName] || null;
      }
    } catch(e) {}
    return null;
  }

  const ReelRenderer = {
    // 描画関数の事前確認・初期化フック
    initSymbolCache: function() {},

    // リールキャンバス描画（表示窓 138px 限定ビューポート描画で iOS Safari 制限を100%完全回避）
    renderReelCanvas: function(reel, isSpinning) {
      if (!reel || !reel.ctx || !reel.strip) return;
      const ctx = reel.ctx;
      const strip = reel.strip;
      const totalSyms = strip.length;
      const maxPos = totalSyms * SYMBOL_HEIGHT;

      // 表示枠（100px × 138px）内のみをクリア
      ctx.clearRect(0, 0, CANVAS_WIDTH, VIEWPORT_HEIGHT);

      // 現在のリール回転位置（pos）に基づいて表示窓内に見えているコマ（-1コマ 〜 +3コマ）を直接計算
      const currentPos = ((reel.pos % maxPos) + maxPos) % maxPos;
      const baseIdx = Math.floor(currentPos / SYMBOL_HEIGHT);
      const offsetY = currentPos % SYMBOL_HEIGHT;

      // 表示枠内に収まる4個のコマを描画
      for (let i = -1; i <= 3; i++) {
        const symIndex = (baseIdx + i + totalSyms) % totalSyms;
        const symName = strip[symIndex];
        const drawY = (i * SYMBOL_HEIGHT) - offsetY;

        const drawFn = getDrawFunc(symName);

        if (typeof drawFn === 'function') {
          ctx.save();
          
          // 原点を出力コマのY位置に合わせる
          ctx.translate(0, drawY);

          // 回転中のブラー（透過）効果
          if (isSpinning) {
            ctx.globalAlpha = 0.85;
          }

          // 赤7/BAR 105%限界拡大描画
          if (symName === '7' || symName === 'BAR') {
            ctx.translate(CANVAS_WIDTH / 2, SYMBOL_HEIGHT / 2);
            ctx.scale(1.05, 1.05);
            ctx.translate(-CANVAS_WIDTH / 2, -SYMBOL_HEIGHT / 2);
          }

          // (0, 0) 基準で外部描画関数を安全呼び出し
          drawFn(ctx, 0, 0, CANVAS_WIDTH, SYMBOL_HEIGHT);

          ctx.restore();
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

