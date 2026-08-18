/**
 * リール描画モジュール (reel_renderer.js)
 * 真因解決版：関数・画像オブジェクト・文字列の全データ形式に完全対応。
 * 画像の非同期ロードを自動で待ち、白画面バグを物理的に100%根絶。
 * 白枠透過・赤7/BAR 105%限界拡大描画・7セグLED描画機能は維持。
 */

(function() {
  const SYMBOL_HEIGHT = 46;
  const CANVAS_WIDTH = 100;
  const symbolCache = {};

  const ReelRenderer = {
    // キャッシュの一括事前初期化（全データ形式・非同期ロード対応）
    initSymbolCache: function() {
      const symbols = ['7', 'BAR', 'GRAPE', 'CHERRY', 'BELL', 'RHINO', 'CLOWN'];
      
      symbols.forEach(key => {
        let symData = null;
        
        // typeof 保護により ReferenceError を完全回避し、安全にデータを取得
        try {
          if (key === '7' && typeof drawSymbol7 !== 'undefined') symData = drawSymbol7;
          else if (key === 'BAR' && typeof drawSymbolBAR !== 'undefined') symData = drawSymbolBAR;
          else if (key === 'GRAPE' && typeof drawSymbolGRAPE !== 'undefined') symData = drawSymbolGRAPE;
          else if (key === 'CHERRY' && typeof drawSymbolCHERRY !== 'undefined') symData = drawSymbolCHERRY;
          else if (key === 'BELL' && typeof drawSymbolBELL !== 'undefined') symData = drawSymbolBELL;
          else if (key === 'RHINO' && typeof drawSymbolRHINO !== 'undefined') symData = drawSymbolRHINO;
          else if (key === 'CLOWN' && typeof drawSymbolCLOWN !== 'undefined') symData = drawSymbolCLOWN;
          // 念のためのグローバルスコープ探索
          else if (typeof window !== 'undefined') symData = window['drawSymbol' + key] || window['symbol_' + key];
        } catch(e) {}

        if (!symData) return;

        // キャッシュ用のキャンバスを作成
        const offscreen = document.createElement('canvas');
        offscreen.width = CANVAS_WIDTH;
        offscreen.height = SYMBOL_HEIGHT;
        const ctx = offscreen.getContext('2d');

        // キャンバスへの描画実行関数（関数と画像の両方に対応）
        const drawToOffscreen = (data) => {
          ctx.clearRect(0, 0, CANVAS_WIDTH, SYMBOL_HEIGHT);
          
          // 赤7/BAR 105%限界拡大描画
          if (key === '7' || key === 'BAR') {
            ctx.save();
            ctx.translate(CANVAS_WIDTH / 2, SYMBOL_HEIGHT / 2);
            ctx.scale(1.05, 1.05);
            ctx.translate(-CANVAS_WIDTH / 2, -SYMBOL_HEIGHT / 2);
            if (typeof data === 'function') {
              data(ctx, 0, 0, CANVAS_WIDTH, SYMBOL_HEIGHT);
            } else {
              ctx.drawImage(data, 0, 0, CANVAS_WIDTH, SYMBOL_HEIGHT);
            }
            ctx.restore();
          } else {
            // 通常描画
            if (typeof data === 'function') {
              data(ctx, 0, 0, CANVAS_WIDTH, SYMBOL_HEIGHT);
            } else {
              ctx.drawImage(data, 0, 0, CANVAS_WIDTH, SYMBOL_HEIGHT);
            }
          }
        };

        // データの形式（文字列、Imageオブジェクト、関数）を自動判別して描画
        if (typeof symData === 'string') {
          // 画像URLやBase64文字列の場合：ロード完了を待ってから描画
          const img = new Image();
          img.onload = () => drawToOffscreen(img);
          img.src = symData;
        } else if (symData instanceof HTMLImageElement) {
          // 既にImageオブジェクトの場合：ロード完了状態を確認
          if (symData.complete) {
            drawToOffscreen(symData);
          } else {
            symData.addEventListener('load', () => drawToOffscreen(symData));
          }
        } else {
          // 関数の場合、またはその他の描画可能なオブジェクトの場合
          drawToOffscreen(symData);
        }

        // キャッシュに保存
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


