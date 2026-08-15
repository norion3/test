/**
 * アイムジャグラーEX スロットゲームエンジン (engine.js)
 * 7図柄の解読・レンダリング・リール制御・サウンド・ボーナス判定
 */

(function() {
  // 21コマのリール配列定義（実機準拠）
  const REEL_STRIPS = [
    ['BAR', 'GRAPE', 'RHINO', 'GRAPE', 'BELL', '7', 'RHINO', 'GRAPE', 'RHINO', 'GRAPE', 'BAR', 'CHERRY', 'GRAPE', 'RHINO', 'GRAPE', '7', 'CLOWN', 'GRAPE', 'RHINO', 'GRAPE', 'CHERRY'],
    ['RHINO', 'BELL', 'GRAPE', 'CHERRY', 'RHINO', '7', 'GRAPE', 'CHERRY', 'RHINO', 'BELL', 'GRAPE', 'CHERRY', 'RHINO', 'BAR', 'GRAPE', 'CHERRY', 'CLOWN', 'RHINO', '7', 'GRAPE', 'CHERRY'],
    ['GRAPE', 'CLOWN', 'BELL', 'RHINO', 'GRAPE', '7', 'BAR', 'BELL', 'RHINO', 'GRAPE', 'CLOWN', 'BELL', 'RHINO', 'GRAPE', 'CLOWN', 'BELL', 'RHINO', 'GRAPE', 'CLOWN', 'BELL', 'RHINO']
  ];

  // 1コマの高さを70px（整数値）に完全固定（3コマでリール窓縦幅＝210px）
  const SYMBOL_HEIGHT = 70;
  const CANVAS_WIDTH = 100;

  // ゲーム状態
  let credits = 50;
  let betAmount = 0;
  let gamesCount = 0;
  let isSpinning = false;
  let bonusState = null; // 'BIG' | 'REG' | null
  let isPeka = false;
  let soundOn = true;
  let audioCtx = null;
  let reels = [];

  const symbolCanvasCache = {};

  // RLE展開デコーダー (128x128キャンバス復元)
  function decodeRLEToCanvas(symData) {
    const cvs = document.createElement('canvas');
    cvs.width = 128;
    cvs.height = 128;
    const ctx = cvs.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 128, 128);

    if (!symData || !symData.rle) return cvs;

    const imgData = ctx.createImageData(symData.w, symData.h);
    const data = imgData.data;
    const palette = symData.palette;
    const chunks = symData.rle.split(',');

    let pixelIndex = 0;
    for (let i = 0; i < chunks.length; i++) {
      const parts = chunks[i].split(':');
      const colorIdx = parseInt(parts[0], 10);
      const count = parseInt(parts[1], 10);
      const hex = palette[colorIdx] || '#ffffff';

      const r = parseInt(hex.substring(1, 3), 16) || 255;
      const g = parseInt(hex.substring(3, 5), 16) || 255;
      const b = parseInt(hex.substring(5, 7), 16) || 255;

      for (let c = 0; c < count; c++) {
        const idx = pixelIndex * 4;
        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = 255;
        pixelIndex++;
      }
    }

    ctx.putImageData(imgData, symData.x, symData.y);
    return cvs;
  }

  // 7図柄キャッシュ初期化
  function initSymbolCache() {
    const ALL_IDS = ['7', 'BAR', 'GRAPE', 'CHERRY', 'BELL', 'RHINO', 'CLOWN'];
    const dataStore = window.SLOT_SYMBOLS_DATA || {};

    ALL_IDS.forEach(id => {
      if (dataStore[id]) {
        symbolCanvasCache[id] = {
          canvas: decodeRLEToCanvas(dataStore[id]),
          meta: dataStore[id]
        };
      } else {
        const cvs = document.createElement('canvas');
        cvs.width = 128; cvs.height = 128;
        const ctx = cvs.getContext('2d');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 128, 128);
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 24px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(id, 64, 64);
        symbolCanvasCache[id] = {
          canvas: cvs,
          meta: { x: 0, y: 0, w: 128, h: 128 }
        };
      }
    });
  }

  // キャンバスに1図柄を描画（実機画像に基づく「7/BAR＝大型」「その他＝中型」サイズ打ち分け）
  function drawSymbol(ctx, type, y) {
    const cached = symbolCanvasCache[type];

    ctx.save();
    ctx.translate(0, y);

    // コマ背景（純白＆区切り境界線）
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, CANVAS_WIDTH, SYMBOL_HEIGHT);
    ctx.strokeStyle = "rgba(0,0,0,0.08)";
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, CANVAS_WIDTH, SYMBOL_HEIGHT);

    if (cached) {
      const masterCanvas = cached.canvas;
      const meta = cached.meta;

      let maxW, maxH;
      if (type === '7' || type === 'BAR') {
        // 大型図柄（7・BAR）：コマ横幅の約90%を使用する幅広・迫力表示
        maxW = CANVAS_WIDTH * 0.90;
        maxH = SYMBOL_HEIGHT * 0.88;
      } else {
        // 中型図柄（ぶどう・チェリー・ベル・ツノッチ・ピエロ）：コマ横幅の約58%に収まるスマート表示
        maxW = CANVAS_WIDTH * 0.58;
        maxH = SYMBOL_HEIGHT * 0.70;
      }

      const scale = Math.min(maxW / meta.w, maxH / meta.h);
      const drawW = meta.w * scale;
      const drawH = meta.h * scale;

      const drawX = (CANVAS_WIDTH - drawW) / 2;
      const drawY = (SYMBOL_HEIGHT - drawH) / 2;

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      ctx.drawImage(
        masterCanvas,
        meta.x, meta.y, meta.w, meta.h,
        drawX, drawY, drawW, drawH
      );
    }
    ctx.restore();
  }

  // オーディオ初期化＆再生
  function initAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }

  function playSound(type) {
    if (!soundOn || !audioCtx) return;
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);

    if (type === 'lever') {
      osc.type = 'sawtooth'; osc.frequency.setValueAtTime(280, now); osc.frequency.exponentialRampToValueAtTime(50, now + 0.08);
      gain.gain.setValueAtTime(0.3, now); gain.gain.linearRampToValueAtTime(0.01, now + 0.08);
      osc.start(now); osc.stop(now + 0.08);
    } else if (type === 'stop') {
      osc.type = 'triangle'; osc.frequency.setValueAtTime(140, now); osc.frequency.exponentialRampToValueAtTime(30, now + 0.06);
      gain.gain.setValueAtTime(0.4, now); gain.gain.linearRampToValueAtTime(0.01, now + 0.06);
      osc.start(now); osc.stop(now + 0.06);
    } else if (type === 'gako') {
      osc.type = 'square'; osc.frequency.setValueAtTime(750, now); osc.frequency.exponentialRampToValueAtTime(90, now + 0.14);
      gain.gain.setValueAtTime(0.8, now); gain.gain.linearRampToValueAtTime(0.01, now + 0.14);
      osc.start(now); osc.stop(now + 0.14);
    } else if (type === 'pay') {
      osc.type = 'sine'; osc.frequency.setValueAtTime(880, now); osc.frequency.setValueAtTime(1760, now + 0.04);
      gain.gain.setValueAtTime(0.2, now); gain.gain.linearRampToValueAtTime(0.01, now + 0.08);
      osc.start(now); osc.stop(now + 0.08);
    }
  }

  // ディスプレイ更新
  function updateDisplays(payout = 0) {
    const cEl = document.getElementById('creditDisp');
    const gEl = document.getElementById('countDisp');
    const pEl = document.getElementById('payoutDisp');
    if (cEl) cEl.textContent = credits;
    if (gEl) gEl.textContent = gamesCount;
    if (pEl) pEl.textContent = payout;
  }

  // スロットエンジンの公開API＆初期化
  window.JUGGLER_ENGINE = {
    isInitialized: false,
    init: function() {
      if (this.isInitialized) return;
      initSymbolCache();

      reels = REEL_STRIPS.map((strip, idx) => {
        const canvas = document.getElementById(`reelCanvas${idx}`);
        if (!canvas) return null;
        canvas.width = CANVAS_WIDTH;
        canvas.height = SYMBOL_HEIGHT * strip.length * 3;
        const ctx = canvas.getContext('2d');
        const tripleStrip = [...strip, ...strip, ...strip];
        
        tripleStrip.forEach((sym, i) => { drawSymbol(ctx, sym, i * SYMBOL_HEIGHT); });
        const currentIdx = Math.floor(Math.random() * strip.length);
        const initialPos = currentIdx * SYMBOL_HEIGHT;
        canvas.style.transform = `translateY(-${initialPos}px)`;

        return {
          id: idx, strip: strip, canvas: canvas, ctx: ctx,
          currentIndex: currentIdx, isSpinning: false, speed: 0,
          pos: initialPos, animId: null
        };
      }).filter(Boolean);

      updateDisplays();
      this.bindEvents();
      this.isInitialized = true;
    },

    bindEvents: function() {
      const betBtn = document.getElementById('betBtn');
      const startBtn = document.getElementById('startBtn');
      const stopBtns = [
        document.getElementById('stopBtn0'),
        document.getElementById('stopBtn1'),
        document.getElementById('stopBtn2')
      ];
      const soundToggle = document.getElementById('soundToggle');

      if (betBtn) {
        betBtn.onclick = () => {
          initAudio();
          if (isSpinning || betAmount === 3 || credits < 3) return;
          credits -= 3; betAmount = 3; playSound('pay'); updateDisplays();
        };
      }

      if (startBtn) {
        startBtn.onclick = () => {
          initAudio();
          if (isSpinning) return;
          if (betAmount < 3) {
            if (credits < 3) { alert('クレジットがありません'); return; }
            credits -= 3; betAmount = 3;
          }
          gamesCount++; isSpinning = true; updateDisplays(0); playSound('lever');

          if (!bonusState) {
            const rand = Math.random();
            if (rand < (1 / 255)) bonusState = 'BIG';
            else if (rand < (2 / 255)) bonusState = 'REG';
          }

          const gogoBox = document.getElementById('gogoBox');
          if (bonusState && !isPeka && Math.random() < 0.25) {
            isPeka = true;
            if (gogoBox) gogoBox.classList.add('peka');
            playSound('gako');
          }

          reels.forEach((reel, i) => {
            reel.isSpinning = true;
            reel.speed = 35 + i * 2;
            this.spinReel(reel);
            if (stopBtns[i]) stopBtns[i].disabled = false;
          });
          updateDisplays();
        };
      }

      stopBtns.forEach((btn, index) => {
        if (!btn) return;
        btn.onclick = () => {
          const reel = reels[index];
          if (!reel.isSpinning) return;
          cancelAnimationFrame(reel.animId);
          reel.isSpinning = false;
          btn.disabled = true;
          playSound('stop');

          // 現在位置から最も近い整数のコマ位置へ一発計算
          const maxPos = reel.strip.length * SYMBOL_HEIGHT;
          let baseIdx = Math.round(reel.pos / SYMBOL_HEIGHT) % reel.strip.length;
          if (baseIdx < 0) baseIdx += reel.strip.length;
          
          let targetIdx = baseIdx;

          // ボーナス成立時の引き込み制御（最大4コマ引き込み）
          if (bonusState) {
            const targetSym = bonusState === 'BIG' ? '7' : (index === 2 ? 'BAR' : '7');
            for (let slip = 0; slip <= 4; slip++) {
              const checkIdx = (baseIdx - slip + reel.strip.length) % reel.strip.length;
              if (reel.strip[checkIdx] === targetSym) { 
                targetIdx = checkIdx; 
                break; 
              }
            }
          }

          // 完全グリッド吸着（縦3コマ枠内にピッタリズレなしで整列停止）
          reel.currentIndex = targetIdx;
          reel.pos = targetIdx * SYMBOL_HEIGHT;
          reel.canvas.style.transform = `translateY(-${reel.pos}px)`;

          if (reels.every(r => !r.isSpinning)) {
            this.onAllStopped();
          }
        };
      });

      if (soundToggle) {
        soundToggle.onclick = () => {
          soundOn = !soundOn;
          soundToggle.textContent = soundOn ? '🔊 サウンド: ON' : '🔇 サウンド: OFF';
        };
      }
    },

    // リール回転処理（実機通りの「上から下」滑らか回転）
    spinReel: function(reel) {
      const maxPos = reel.strip.length * SYMBOL_HEIGHT;
      const animate = () => {
        if (!reel.isSpinning) return;
        
        reel.pos = (reel.pos - reel.speed + maxPos) % maxPos;
        reel.canvas.style.transform = `translateY(-${reel.pos}px)`;
        reel.animId = requestAnimationFrame(animate);
      };
      animate();
    },

    onAllStopped: function() {
      isSpinning = false;
      betAmount = 0;
      const gogoBox = document.getElementById('gogoBox');

      if (bonusState && !isPeka) {
        isPeka = true;
        if (gogoBox) gogoBox.classList.add('peka');
        playSound('gako');
      }

      const getSym = (rIdx, offset) => {
        const strip = reels[rIdx].strip;
        return strip[(reels[rIdx].currentIndex + offset + strip.length) % strip.length];
      };

      const center = [getSym(0, 1), getSym(1, 1), getSym(2, 1)];
      let payout = 0;

      if (center.every(s => s === '7')) {
        payout = 312; bonusState = null;
        setTimeout(() => alert('🎉 BIG BONUS! (+312枚)'), 100);
      } else if (center[0] === '7' && center[1] === '7' && center[2] === 'BAR') {
        payout = 104; bonusState = null;
        setTimeout(() => alert('✨ REG BONUS! (+104枚)'), 100);
      } else {
        if (center.every(s => s === 'GRAPE')) payout = 7;
        else if (center[0] === 'CHERRY') payout = 2;
        else if (center.every(s => s === 'BELL')) payout = 14;
        else if (center.every(s => s === 'RHINO')) payout = 3;
      }

      if (!bonusState && payout >= 100 && gogoBox) {
        isPeka = false;
        gogoBox.classList.remove('peka');
      }

      if (payout > 0) {
        credits += payout;
        playSound('pay');
      }

      updateDisplays(payout);
    }
  };
})();

