/**
 * リール描画専門モジュール (reel_renderer.js)
 * レイジーキャッシュ自動生成・RLEデコーダー・赤7/BAR 105%限界拡大描画・7セグLED制御
 */

(function() {
  const SYMBOL_HEIGHT = 46;
  const CANVAS_WIDTH = 100;
  const symbolCanvasCache = {};

  // 7セグメントLEDセグメントマップ
  const SEGMENT_MAP = {
    '0': ['a','b','c','d','e','f'], '1': ['b','c'], '2': ['a','b','d','e','g'],
    '3': ['a','b','c','d','g'], '4': ['b','c','f','g'], '5': ['a','c','d','f','g'],
    '6': ['a','c','d','e','f','g'], '7': ['a','b','c'], '8': ['a','b','c','d','e','f','g'],
    '9': ['a','b','c','d','f','g'], '-': ['g'], ' ': []
  };

  const ReelRenderer = {
    // 7セグメントLEDの点灯状態更新
    update7SegDisplay: function(containerId, value, digits = 2) {
      const container = document.getElementById(containerId);
      if (!container) return;
      
      let valStr = String(value).padStart(digits, ' ');
      const digitSVGs = container.querySelectorAll('.digit7seg');
      if (digitSVGs.length !== digits) return;
      
      for (let i = 0; i < digits; i++) {
        const char = valStr[i] || ' ';
        const litSegs = SEGMENT_MAP[char] || [];
        const segElems = digitSVGs[i].querySelectorAll('.seg');
        segElems.forEach(elem => {
          let segName = '';
          if (elem.classList) {
            elem.classList.forEach(cls => {
              if (cls.startsWith('seg-')) segName = cls.replace('seg-', '');
            });
          }
          elem.classList.toggle('lit', litSegs.includes(segName));
        });
      }
    },

    // RLEデコードと白枠透明化・精密クロップ処理
    decodeRLEToCanvasPrecisionCrop: function(symData) {
      const rawCvs = document.createElement('canvas');
      rawCvs.width = 128; 
      rawCvs.height = 128;
      const rawCtx = rawCvs.getContext('2d');
      rawCtx.clearRect(0, 0, 128, 128);

      if (!symData || !symData.rle) {
        return { canvas: rawCvs, crop: { x: 0, y: 22, w: 128, h: 84 } };
      }

      const imgData = rawCtx.createImageData(symData.w, symData.h);
      const data = imgData.data;
      const palette = symData.palette;
      const chunks = symData.rle.split(',');

      let pixelIndex = 0;
      for (let i = 0; i < chunks.length; i++) {
        const parts = chunks[i].split(':');
        const count = parseInt(parts[1], 10);
        const hex = palette[parseInt(parts[0], 10)] || '#ffffff';
        
        const hexLower = hex.toLowerCase();
        // 白色セルは透過処理（アルファ値 0）
        const isWhite = (hexLower === '#ffffff' || hexLower === '#fff' || hexLower === '#ffffffff');
        
        const r = parseInt(hex.substring(1, 3), 16) || 255;
        const g = parseInt(hex.substring(3, 5), 16) || 255;
        const b = parseInt(hex.substring(5, 7), 16) || 255;
        const a = isWhite ? 0 : 255;

        for (let c = 0; c < count; c++) {
          const idx = pixelIndex * 4;
          data[idx] = r; 
          data[idx+1] = g; 
          data[idx+2] = b; 
          data[idx+3] = a;
          pixelIndex++;
        }
      }
      rawCtx.putImageData(imgData, symData.x, symData.y);
      return { canvas: rawCvs, crop: { x: 0, y: 22, w: 128, h: 84 } };
    },

    // 全図柄の初期化およびオフスキャンキャッシュ作成
    initSymbolCache: function() {
      const ALL_IDS = ['7', 'BAR', 'GRAPE', 'CHERRY', 'BELL', 'RHINO', 'CLOWN'];
      const dataStore = window.SLOT_SYMBOLS_DATA || {};
      ALL_IDS.forEach(id => {
        if (dataStore[id]) {
          symbolCanvasCache[id] = this.decodeRLEToCanvasPrecisionCrop(dataStore[id]);
        }
      });
    },

    // 単一シンボルの描画 (赤7・BARは105%限界拡大 ＆ レイジーキャッシュ機構)
    drawSymbol: function(ctx, type, y, isReelSpinning = false) {
      if (!ctx) return;

      // キャッシュが存在しないか未完了の場合、遅延自動生成（レイジーキャッシュ）を試みる
      if (!symbolCanvasCache[type]) {
        this.initSymbolCache();
      }

      const cached = symbolCanvasCache[type];
      // 二重ガード: キャッシュが取得できない場合は安全に描画をスキップ（クラッシュ防止）
      if (!cached || !cached.canvas) return;

      ctx.save();
      ctx.translate(0, y);

      // 【不変要件】赤7とBARはコマ高(46px)に対して「105%」限界突破拡大。他小役は85%に抑える。
      let maxH = (type === '7' || type === 'BAR') ? SYMBOL_HEIGHT * 1.05 : SYMBOL_HEIGHT * 0.85;
      let maxW = (type === '7' || type === 'BAR') ? CANVAS_WIDTH * 1.05 : CANVAS_WIDTH * 0.80;

      const scale = Math.min(maxW / cached.crop.w, maxH / cached.crop.h);
      let drawW = cached.crop.w * scale;
      let drawH = cached.crop.h * scale;

      const drawX = Math.round((CANVAS_WIDTH - drawW) / 2);
      const drawY = Math.round((SYMBOL_HEIGHT - drawH) / 2);

      ctx.imageSmoothingEnabled = !isReelSpinning;
      ctx.drawImage(cached.canvas, cached.crop.x, cached.crop.y, cached.crop.w, cached.crop.h, drawX, drawY, drawW, drawH);
      
      ctx.restore();
    },

    // リール全体キャンバスの再描画
    renderReelCanvas: function(reel, isSpinning) {
      if (!reel || !reel.ctx || !reel.strip) return;
      const tripleStrip = [...reel.strip, ...reel.strip, ...reel.strip];
      reel.ctx.clearRect(0, 0, reel.canvas.width, reel.canvas.height);
      tripleStrip.forEach((sym, i) => {
        this.drawSymbol(reel.ctx, sym, i * SYMBOL_HEIGHT, isSpinning);
      });
    }
  };

  window.REEL_RENDERER = ReelRenderer;
})();

