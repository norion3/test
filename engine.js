/**
 * アイムジャグラーEX スロットゲームエンジン (engine.js)
 * SアイムジャグラーEX 実機スペック・5ライン判定・目押しアシスト・後ペカ演出完全対応
 */

(function() {
  // 21コマの実機リール配列定義
  const REEL_STRIPS = [
    ['BAR', 'GRAPE', 'RHINO', 'GRAPE', 'BELL', '7', 'RHINO', 'GRAPE', 'RHINO', 'GRAPE', 'BAR', 'CHERRY', 'GRAPE', 'RHINO', 'GRAPE', '7', 'CLOWN', 'GRAPE', 'RHINO', 'GRAPE', 'CHERRY'],
    ['RHINO', 'BELL', 'GRAPE', 'CHERRY', 'RHINO', '7', 'GRAPE', 'CHERRY', 'RHINO', 'BELL', 'GRAPE', 'CHERRY', 'RHINO', 'BAR', 'GRAPE', 'CHERRY', 'CLOWN', 'RHINO', '7', 'GRAPE', 'CHERRY'],
    ['GRAPE', 'CLOWN', 'BELL', 'RHINO', 'GRAPE', '7', 'BAR', 'BELL', 'RHINO', 'GRAPE', 'CLOWN', 'BELL', 'RHINO', 'GRAPE', 'CLOWN', 'BELL', 'RHINO', 'GRAPE', 'CLOWN', 'BELL', 'RHINO']
  ];

  const SYMBOL_HEIGHT = 70;
  const CANVAS_WIDTH = 100;
  const REEL_SPEED_BASE = 33; // 1回転0.75秒（実機同期スピード）

  // P-WORLD掲載 SアイムジャグラーEX 実機確率テーブル
  const PROBABILITY_TABLE = {
    1: { big: 1/273.1, reg: 1/439.8 },
    2: { big: 1/269.7, reg: 1/399.6 },
    3: { big: 1/269.7, reg: 1/330.7 },
    4: { big: 1/259.0, reg: 1/315.1 },
    5: { big: 1/259.0, reg: 1/255.0 },
    6: { big: 1/255.0, reg: 1/255.0 }
  };

  // ゲーム内部状態
  let currentSetting = 6;
  let credits = 50;
  let betAmount = 0;
  let gamesCount = 0;
  let isSpinning = false;
  let bonusState = null; // 'BIG' | 'REG' | null
  let isPeka = false;
  let pekaTiming = null; // 'LEVER' | 'STOP1' | 'STOP3_DOWN' | 'STOP3_UP'
  let isReplay = false;
  let soundOn = true;
  let audioCtx = null;
  let reels = [];

  const symbolCanvasCache = {};

  // RLE展開デコーダー
  function decodeRLEToCanvas(symData) {
    const cvs = document.createElement('canvas');
    cvs.width = 128; cvs.height = 128;
    const ctx = cvs.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 128, 128);
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
        data[idx] = r; data[idx+1] = g; data[idx+2] = b; data[idx+3] = 255;
        pixelIndex++;
      }
    }
    ctx.putImageData(imgData, symData.x, symData.y);
    return cvs;
  }

  // 図柄キャッシュの構築
  function initSymbolCache() {
    const ALL_IDS = ['7', 'BAR', 'GRAPE', 'CHERRY', 'BELL', 'RHINO', 'CLOWN'];
    const dataStore = window.SLOT_SYMBOLS_DATA || {};

    ALL_IDS.forEach(id => {
      if (dataStore[id]) {
        symbolCanvasCache[id] = { canvas: decodeRLEToCanvas(dataStore[id]), meta: dataStore[id] };
      } else {
        const cvs = document.createElement('canvas');
        cvs.width = 128; cvs.height = 128;
        const ctx = cvs.getContext('2d');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 128, 128);
        ctx.fillStyle = '#000000'; ctx.font = 'bold 24px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(id, 64, 64);
        symbolCanvasCache[id] = { canvas: cvs, meta: { x: 0, y: 0, w: 128, h: 128 } };
      }
    });
  }

  // キャンバスへ図柄描画（7/BAR＝特大88%, 小役＝中型45%。透過面発光演出対応）
  function drawSymbol(ctx, type, y, isReelSpinning = false) {
    const cached = symbolCanvasCache[type];
    ctx.save();
    ctx.translate(0, y);

    // 回転中限定：7/BAR裏からの透過光色
    if (isReelSpinning && type === '7') {
      ctx.fillStyle = "rgba(255, 210, 210, 0.9)";
    } else if (isReelSpinning && type === 'BAR') {
      ctx.fillStyle = "rgba(255, 255, 255, 1.0)";
    } else {
      ctx.fillStyle = "#ffffff";
    }
    ctx.fillRect(0, 0, CANVAS_WIDTH, SYMBOL_HEIGHT);

    if (cached) {
      let maxW = (type === '7' || type === 'BAR') ? CANVAS_WIDTH * 0.88 : CANVAS_WIDTH * 0.45;
      let maxH = (type === '7' || type === 'BAR') ? SYMBOL_HEIGHT * 0.88 : SYMBOL_HEIGHT * 0.50;

      const scale = Math.min(maxW / cached.meta.w, maxH / cached.meta.h);
      const drawW = cached.meta.w * scale;
      const drawH = cached.meta.h * scale;
      const drawX = (CANVAS_WIDTH - drawW) / 2;
      const drawY = (SYMBOL_HEIGHT - drawH) / 2;

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      if (isReelSpinning) {
        if (type === '7') {
          ctx.shadowColor = 'rgba(255, 0, 0, 1.0)';
          ctx.shadowBlur = 20;
          ctx.filter = 'brightness(1.3)';
        } else if (type === 'BAR') {
          ctx.shadowColor = 'rgba(255, 255, 255, 1.0)';
          ctx.shadowBlur = 18;
          ctx.filter = 'brightness(1.3)';
        }
      }

      ctx.drawImage(cached.canvas, cached.meta.x, cached.meta.y, cached.meta.w, cached.meta.h, drawX, drawY, drawW, drawH);
    }
    ctx.restore();
  }

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

  function updateDisplays(payout = 0) {
    if (credits < 3) credits = 50; // コイン切れなし（自動補給）
    const cEl = document.getElementById('creditDisp');
    const gEl = document.getElementById('countDisp');
    const pEl = document.getElementById('payoutDisp');
    if (cEl) cEl.textContent = credits;
    if (gEl) gEl.textContent = gamesCount;
    if (pEl) pEl.textContent = isReplay ? 'REPLAY' : payout;
  }

  function triggerPeka() {
    if (isPeka) return;
    isPeka = true;
    const gogoBox = document.getElementById('gogoBox');
    if (gogoBox) gogoBox.classList.add('peka');
    playSound('gako');
  }

  // 外部からエンジンを操作可能なグローバルオブジェクト
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
        
        tripleStrip.forEach((sym, i) => { drawSymbol(ctx, sym, i * SYMBOL_HEIGHT, false); });
        const currentIdx = Math.floor(Math.random() * strip.length);
        const initialPos = currentIdx * SYMBOL_HEIGHT;
        canvas.style.transform = `translateY(-${initialPos}px)`;

        return {
          id: idx, strip: strip, canvas: canvas, ctx: ctx,
          currentIndex: currentIdx, isSpinning: false, isStopping: false,
          speed: 0, pos: initialPos, targetPos: 0, animId: null
        };
      }).filter(Boolean);

      updateDisplays();
      this.bindEvents();
      this.isInitialized = true;
    },

    renderReelCanvas: function(reel, isSpinning) {
      const tripleStrip = [...reel.strip, ...reel.strip, ...reel.strip];
      reel.ctx.clearRect(0, 0, reel.canvas.width, reel.canvas.height);
      tripleStrip.forEach((sym, i) => { drawSymbol(reel.ctx, sym, i * SYMBOL_HEIGHT, isSpinning); });
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
      const settingToggle = document.getElementById('settingToggle');

      // タッチ遅延ゼロ化ヘルパー (`touchstart` / `pointerdown` 即時反応)
      const attachFastTouch = (elem, handlerOnDown, handlerOnUp = null) => {
        if (!elem) return;
        let handled = false;

        const downTrigger = (e) => {
          if (e.type === 'touchstart' || e.type === 'pointerdown') handled = true;
          else if (e.type === 'click' && handled) { handled = false; return; }
          if (handlerOnDown) handlerOnDown(e);
        };

        const upTrigger = (e) => {
          if (handlerOnUp) handlerOnUp(e);
        };

        elem.addEventListener('touchstart', downTrigger, { passive: false });
        elem.addEventListener('pointerdown', downTrigger);
        elem.addEventListener('click', downTrigger);

        if (handlerOnUp) {
          elem.addEventListener('touchend', upTrigger, { passive: false });
          elem.addEventListener('pointerup', upTrigger);
          elem.addEventListener('mouseup', upTrigger);
        }
      };

      // BETボタン
      attachFastTouch(betBtn, (e) => {
        if (e.cancelable) e.preventDefault();
        initAudio();
        if (isSpinning || betAmount === 3) return;
        if (credits < 3) credits = 50; 
        credits -= 3; betAmount = 3; playSound('pay'); updateDisplays();
      });

      // スタートレバー
      attachFastTouch(startBtn, (e) => {
        if (e.cancelable) e.preventDefault();
        initAudio();
        if (isSpinning) return;
        
        if (!isReplay) {
          if (credits < 3) credits = 50; 
          if (betAmount < 3) { credits -= 3; betAmount = 3; }
        } else {
          betAmount = 3; isReplay = false; // リプレイ時はBET自動消費なし
        }
        gamesCount++; isSpinning = true; updateDisplays(0); playSound('lever');

        // フラグ抽選 (実機設定確率テーブル適用)
        if (!bonusState) {
          const prob = PROBABILITY_TABLE[currentSetting];
          const rand = Math.random();
          if (rand < prob.big) bonusState = 'BIG';
          else if (rand < (prob.big + prob.reg)) bonusState = 'REG';

          if (bonusState) {
            const pekaRand = Math.random();
            if (pekaRand < 0.125) pekaTiming = 'LEVER';
            else if (pekaRand < 0.1875) pekaTiming = 'STOP1';
            else if (pekaRand < 0.25) pekaTiming = 'STOP3_DOWN';
            else pekaTiming = 'STOP3_UP'; // 後ペカ (75%)
          }
        }

        if (bonusState && pekaTiming === 'LEVER') triggerPeka();

        reels.forEach((reel, i) => {
          reel.isSpinning = true;
          reel.isStopping = false;
          reel.speed = REEL_SPEED_BASE; 
          this.renderReelCanvas(reel, true); 
          this.spinReel(reel);
          if (stopBtns[i]) stopBtns[i].disabled = false;
        });
        updateDisplays();
      });

      // ストップボタン (1, 2, 3)
      stopBtns.forEach((btn, index) => {
        if (!btn) return;
        attachFastTouch(btn, 
          // DOWN (押した瞬間の処理)
          (e) => {
            if (e.cancelable) e.preventDefault();
            const reel = reels[index];
            if (!reel.isSpinning || reel.isStopping) return;
            btn.disabled = true; playSound('stop');

            if (index === 0 && bonusState && pekaTiming === 'STOP1') triggerPeka();
            if (index === 2 && bonusState && pekaTiming === 'STOP3_DOWN') triggerPeka();

            // Math.floor 基準による遅延なし位置算出
            const maxPos = reel.strip.length * SYMBOL_HEIGHT;
            let baseIdx = Math.floor(reel.pos / SYMBOL_HEIGHT) % reel.strip.length;
            if (baseIdx < 0) baseIdx += reel.strip.length;
            let targetIdx = baseIdx;

            // 枠内4コマすべり・引き込みアシスト制御
            if (bonusState) {
              const targetSym = bonusState === 'BIG' ? '7' : (index === 2 ? 'BAR' : '7');
              let found = false;
              for (let slip = 0; slip <= 4; slip++) {
                const checkTopIdx = (baseIdx - slip + reel.strip.length) % reel.strip.length;
                for (let offset = 0; offset <= 2; offset++) {
                  const checkSymIdx = (checkTopIdx + offset) % reel.strip.length;
                  if (reel.strip[checkSymIdx] === targetSym) {
                    targetIdx = checkTopIdx; found = true; break;
                  }
                }
                if (found) break;
              }
              if (!found) targetIdx = baseIdx;
            } else {
              targetIdx = baseIdx;
            }

            reel.currentIndex = targetIdx;
            reel.targetPos = targetIdx * SYMBOL_HEIGHT;
            reel.isStopping = true;
          },
          // UP (第3ボタンから指を離した瞬間の「後ペカ 75%」処理)
          (e) => {
            if (index === 2 && bonusState && pekaTiming === 'STOP3_UP') {
              triggerPeka();
            }
          }
        );
      });

      if (soundToggle) {
        soundToggle.onclick = () => { soundOn = !soundOn; soundToggle.textContent = soundOn ? '🔊 サウンド: ON' : '🔇 サウンド: OFF'; };
      }
      if (settingToggle) {
        settingToggle.onclick = () => {
          if (isSpinning) return;
          currentSetting = (currentSetting % 6) + 1;
          settingToggle.textContent = `⚙️ 設定: ${currentSetting}`;
        };
      }
    },

    spinReel: function(reel) {
      const maxPos = reel.strip.length * SYMBOL_HEIGHT;
      const animate = () => {
        if (!reel.isSpinning) return;
        if (reel.isStopping) {
          let dist = (reel.pos - reel.targetPos + maxPos) % maxPos;
          if (dist <= reel.speed || dist < 2) {
            reel.pos = reel.targetPos; reel.isSpinning = false; reel.isStopping = false;
            cancelAnimationFrame(reel.animId);
            reel.canvas.style.transform = `translateY(-${reel.pos}px)`;
            this.renderReelCanvas(reel, false); // 静止画へ
            if (reels.every(r => !r.isSpinning)) this.onAllStopped();
            return;
          } else {
            reel.pos = (reel.pos - Math.min(reel.speed, dist) + maxPos) % maxPos;
          }
        } else {
          reel.pos = (reel.pos - reel.speed + maxPos) % maxPos;
        }
        reel.canvas.style.transform = `translateY(-${reel.pos}px)`;
        reel.animId = requestAnimationFrame(animate);
      };
      animate();
    },

    // 実機 5ライン判定＆純増払出
    onAllStopped: function() {
      isSpinning = false; betAmount = 0;
      const gogoBox = document.getElementById('gogoBox');
      const getSym = (rIdx, offset) => {
        const strip = reels[rIdx].strip;
        return strip[(reels[rIdx].currentIndex + offset + strip.length) % strip.length];
      };

      // 5つの有効判定ライン
      const lines = [
        [getSym(0, 0), getSym(1, 0), getSym(2, 0)], // 上段
        [getSym(0, 1), getSym(1, 1), getSym(2, 1)], // 中段
        [getSym(0, 2), getSym(1, 2), getSym(2, 2)], // 下段
        [getSym(0, 0), getSym(1, 1), getSym(2, 2)], // 右下がり
        [getSym(0, 2), getSym(1, 1), getSym(2, 0)]  // 右上がり
      ];

      let payout = 0;
      let isBigWin = false, isRegWin = false, isReplayWin = false;

      lines.forEach(line => {
        if (line.every(s => s === '7')) isBigWin = true;
        else if (line[0] === '7' && line[1] === '7' && line[2] === 'BAR') isRegWin = true;
        else if (line.every(s => s === 'RHINO')) isReplayWin = true; // ツノッチ＝リプレイ
        else {
          if (line.every(s => s === 'GRAPE')) payout = Math.max(payout, 8);
          else if (line[0] === 'CHERRY') payout = Math.max(payout, 2);
          else if (line.every(s => s === 'BELL')) payout = Math.max(payout, 14);
          else if (line.every(s => s === 'CLOWN')) payout = Math.max(payout, 10);
        }
      });

      // 6号機 SアイムジャグラーEX 払出枚数
      if (isBigWin) { payout = 252; bonusState = null; setTimeout(() => alert('🎉 BIG BONUS! (+252枚)'), 100); }
      else if (isRegWin) { payout = 96; bonusState = null; setTimeout(() => alert('✨ REG BONUS! (+96枚)'), 100); }
      else if (isReplayWin) { isReplay = true; playSound('pay'); }

      if (!bonusState && payout >= 90 && gogoBox) { isPeka = false; gogoBox.classList.remove('peka'); }
      if (payout > 0) { credits += payout; playSound('pay'); }
      updateDisplays(payout);
    }
  };
})();

