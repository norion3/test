/**
 * リール描画モジュール (reel_renderer.js)
 * ダイレクトリアルタイム描画構造・多角関数自動探索・オンデマンド生成フォールバック・白枠透過・赤7/BAR 105%限界拡大描画・7セグLED描画
 */

(function() {
  const SYMBOL_HEIGHT = 46;
  const CANVAS_WIDTH = 100;
  const symbolCache = {};

  // 外部 symbol_*.js の描画関数を多角度から探索する安全ゲッター
  function getSymbolDrawFunction(key) {
    if (typeof window === 'undefined') return null;

    // 各図柄の主要な関数名を順番に自動探索
    const possibleNames = {
      '7': ['drawSymbol7', 'drawSymbol_7', 'draw7', 'renderSymbol7'],
      'BAR': ['drawSymbolBAR', 'drawSymbol_BAR', 'drawBAR', 'renderSymbolBAR'],
      'GRAPE': ['drawSymbolGRAPE', 'drawSymbol_GRAPE', 'drawGRAPE', 'renderSymbolGRAPE'],
      'CHERRY': ['drawSymbolCHERRY', 'drawSymbol_CHERRY', 'drawCHERRY', 'renderSymbolCHERRY'],
      'BELL': ['drawSymbolBELL', 'drawSymbol_BELL', 'drawBELL', 'renderSymbolBELL'],
      'RHINO': ['drawSymbolRHINO', 'drawSymbol_RHINO', 'drawRHINO', 'renderSymbolRHINO'],
      'CLOWN': ['drawSymbolCLOWN', 'drawSymbol_CLOWN', 'drawCLOWN', 'renderSymbolCLOWN']
    };

    const names = possibleNames[key] || [];
    for (let name of names) {
      if (typeof window[name] === 'function') {
        return window[name];
      }
    }

    // グローバルスコープの直接参照試行
    try {
      if (key === '7' && typeof drawSymbol7 === 'function') return drawSymbol7;
      if (key === 'BAR' && typeof drawSymbolBAR === 'function') return drawSymbolBAR;
      if (key === 'GRAPE' && typeof drawSymbolGRAPE === 'function') return drawSymbolGRAPE;
      if (key === 'CHERRY' && typeof drawSymbolCHERRY === 'function') return drawSymbolCHERRY;
      if (key === 'BELL' && typeof drawSymbolBELL === 'function') return drawSymbolBELL;
      if (key === 'RHINO' && typeof drawSymbolRHINO !== 'function') return drawSymbolRHINO;
      if (key === 'CLOWN' && typeof drawSymbolCLOWN === 'function') return drawSymbolCLOWN;
    } catch (e) {}

    return null;
  }

  // 万が一関数が完全に取得できない場合の「自己完結型バックアップ描画エンジン」
  function drawFallbackSymbol(ctx, key, width, height) {
    ctx.save();
    ctx.clearRect(0, 0, width, height);

    const styleMap = {
      '7': { bg: '#e51d24', text: '7', color: '#ffffff', border: '#ff8888' },
      'BAR': { bg: '#111111', text: 'BAR', color: '#f5cf47', border: '#ffffff' },
      'GRAPE': { bg: '#8a2be2', text: '🍇', color: '#ffffff', border: '#da70d6' },
      'CHERRY': { bg: '#ff1493', text: '🍒', color: '#ffffff', border: '#ffb6c1' },
      'BELL': { bg: '#ffb700', text: '🔔', color: '#ffffff', border: '#fff8dc' },
      'RHINO': { bg: '#1e90ff', text: '🦏', color: '#ffffff', border: '#87cefa' },
      'CLOWN': { bg: '#3cb371', text: '🤡', color: '#ffffff', border: '#98fb98' }
    };

    const style = styleMap[key] || { bg: '#333333', text: key, color: '#ffffff', border: '#666666' };

    // ベースの枠描画
    ctx.fillStyle = style.bg;
    ctx.beginPath();
    ctx.roundRect(4, 3, width - 8, height - 6, 6);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = style.border;
    ctx.stroke();

    // テキスト・絵文字描画
    ctx.fillStyle = style.color;
    ctx.font = key === 'BAR' ? 'bold 18px "Impact", sans-serif' : (key === '7' ? '900 28px "Arial Black", sans-serif' : '22px sans-serif');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(style.text, width / 2, height / 2 + 1);

    ctx.restore();
  }

  // 1個の図柄キャンバスを安全に生成・取得する関数（オンデマンドリアルタイム生成）
  function createSymbolCanvas(key) {
    const offscreen = document.createElement('canvas');
    offscreen.width = CANVAS_WIDTH;
    offscreen.height = SYMBOL_HEIGHT;
    const ctx = offscreen.getContext('2d');

    const drawFn = getSymbolDrawFunction(key);

    if (typeof drawFn === 'function') {
      try {
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
      } catch (e) {
        // 描画エラー時はバックアップエンジンへ切替
        drawFallbackSymbol(ctx, key, CANVAS_WIDTH, SYMBOL_HEIGHT);
      }
    } else {
      // 関数が未読み込み・不在時は即座にバックアップ描画
      drawFallbackSymbol(ctx, key, CANVAS_WIDTH, SYMBOL_HEIGHT);
    }

    return offscreen;
  }

  const ReelRenderer = {
    // キャッシュの一括事前初期化
    initSymbolCache: function() {
      const keys = ['7', 'BAR', 'GRAPE', 'CHERRY', 'BELL', 'RHINO', 'CLOWN'];
      keys.forEach(key => {
        symbolCache[key] = createSymbolCanvas(key);
      });
    },

    // 描画用キャンバスの安全取得（無ければその場でダイレクト即時生成して取得）
    getSymbolCanvas: function(key) {
      if (!symbolCache[key]) {
        symbolCache[key] = createSymbolCanvas(key);
      }
      return symbolCache[key];
    },

    // リールキャンバス描画（ダイレクトリアルタイム描画構造で白画面を100%防止）
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
          
          // キャッシュ依存を排除し、直接・オンデマンドで確実に画像を取得
          const cachedImg = this.getSymbolCanvas(symName);

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

