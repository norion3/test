/**
 * スロットゲームエンジン (engine.js)
 * BGMシーケンサー・リセット機能・サウンド即時有効化・超アシスト・図柄限界突破
 */

(function() {
  // 21コマの実機リール配列定義
  const REEL_STRIPS = [
    ['BAR', 'GRAPE', 'RHINO', 'GRAPE', 'BELL', '7', 'RHINO', 'GRAPE', 'RHINO', 'GRAPE', 'BAR', 'CHERRY', 'GRAPE', 'RHINO', 'GRAPE', '7', 'CLOWN', 'GRAPE', 'RHINO', 'GRAPE', 'CHERRY'],
    ['RHINO', 'BELL', 'GRAPE', 'CHERRY', 'RHINO', '7', 'GRAPE', 'CHERRY', 'RHINO', 'BELL', 'GRAPE', 'CHERRY', 'RHINO', 'BAR', 'GRAPE', 'CHERRY', 'CLOWN', 'RHINO', '7', 'GRAPE', 'CHERRY'],
    ['GRAPE', 'CLOWN', 'BELL', 'RHINO', 'GRAPE', '7', 'BAR', 'BELL', 'RHINO', 'GRAPE', 'CLOWN', 'BELL', 'RHINO', 'GRAPE', 'CLOWN', 'BELL', 'RHINO', 'GRAPE', 'CLOWN', 'BELL', 'RHINO']
  ];

  // コマサイズ (横幅100px × 高さ46px) - 縦隙間極限圧縮
  const SYMBOL_HEIGHT = 46;
  const CANVAS_WIDTH = 100;
  const REEL_SPEED_NORMAL = 22; 
  const REEL_SPEED_SLOW = 8;    

  // SアイムジャグラーEX 実機確率テーブル (設定1〜6) + DMM解析 (チェリー重複分離)
  const PROBABILITY_TABLE = {
    1: { sBIG: 1/399.6, cBIG: 1/862.3, sREG: 1/630.2, cREG: 1/1456.4, grape: 1/6.02, cherry: 1/33.03 },
    2: { sBIG: 1/399.6, cBIG: 1/862.3, sREG: 1/565.0, cREG: 1/1365.3, grape: 1/6.02, cherry: 1/33.03 },
    3: { sBIG: 1/399.6, cBIG: 1/862.3, sREG: 1/455.1, cREG: 1/1213.6, grape: 1/6.02, cherry: 1/33.03 },
    4: { sBIG: 1/399.6, cBIG: 1/862.3, sREG: 1/431.2, cREG: 1/1170.3, grape: 1/6.02, cherry: 1/33.03 },
    5: { sBIG: 1/399.6, cBIG: 1/862.3, sREG: 1/334.4, cREG: 1/1074.3, grape: 1/6.02, cherry: 1/33.03 },
    6: { sBIG: 1/381.0, cBIG: 1/772.8, sREG: 1/334.4, cREG: 1/1074.3, grape: 1/5.78, cherry: 1/33.03 }
  };

  const PROB_REPLAY = 1 / 7.3;
  const PROB_BELL   = 1 / 1092.2;
  const PROB_CLOWN  = 1 / 1092.2;

  const STATE_IDLE = 0;
  const STATE_SPINNING = 1;
  let gameState = STATE_IDLE;
  let activeReelsCount = 0;

  // アトミック・タッチセッション管理
  let isTouchActive = false;
  let hasActionExecutedInCurrentTouch = false;

  let currentSetting = 6;
  let autoStopOnBonus = true;
  let weightCut = true;
  let masterVolume = 1.0;
  let soundOn = false;

  let credits = 50;
  let internalCredits = 50;
  let betAmount = 0;
  let isAutoMode = false;
  let autoTimer = null;
  let lastTapTime = 0;

  let currentFlag = null;       
  let bonusFlag = null;         
  let isBonusMode = false;
  let bonusType = null;
  let bonusAcquired = 0;
  let bonusTarget = 0; 

  let isPeka = false;
  let pekaTiming = null;
  let isReplay = false;
  let reels = [];

  const symbolCanvasCache = {};

  // ===================================================
  // 1. 高度リアル音響エンジン ＆ BGMシーケンサー
  // ===================================================
  let isPlayingBGM = false;
  let currentBgmType = null;

  const SoundEngine = {
    ctx: null, masterGain: null, bgmGain: null, audioBuffers: {},
    bgmTimer: null,
    
    init: function() {
      try {
        if (!this.ctx) {
          this.ctx = new (window.AudioContext || window.webkitAudioContext)();
          this.masterGain = this.ctx.createGain();
          this.bgmGain = this.ctx.createGain();
          
          this.masterGain.gain.setValueAtTime(soundOn ? masterVolume : 0, this.ctx.currentTime);
          this.bgmGain.gain.setValueAtTime(soundOn ? masterVolume * 0.4 : 0, this.ctx.currentTime); // BGMは控えめに共存
          
          this.masterGain.connect(this.ctx.destination);
          this.bgmGain.connect(this.ctx.destination);
        }
        if (this.ctx.state === 'suspended') this.ctx.resume();
        this.loadExternalSounds();
      } catch (e) {}
    },
    
    // 【最重要】ブラウザ制約突破用フック (設定適用時に強制発火)
    unlock: function() {
      this.init();
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      try {
        // 空バッファを再生してAudioContextのロックを強制解除
        const buffer = this.ctx.createBuffer(1, 1, 22050);
        const source = this.ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(this.ctx.destination);
        source.start(0);
      } catch(e) {}
    },

    setVolume: function(vol) {
      masterVolume = vol;
      if (this.masterGain && this.ctx) {
        this.masterGain.gain.setTargetAtTime(soundOn ? masterVolume : 0, this.ctx.currentTime, 0.05);
        this.bgmGain.gain.setTargetAtTime(soundOn ? masterVolume * 0.4 : 0, this.ctx.currentTime, 0.05);
      }
    },
    
    loadExternalSounds: function() {
      const soundFiles = {
        bet: 'sounds/bet.mp3', lever: 'sounds/lever.mp3', stop: 'sounds/stop.mp3',
        gako: 'sounds/gako.mp3', grape: 'sounds/grape.mp3', cherry: 'sounds/cherry.mp3',
        replay: 'sounds/replay.mp3', bell_clown: 'sounds/bell_clown.mp3',
        big_fanfare: 'sounds/big_fanfare.mp3', reg_fanfare: 'sounds/reg_fanfare.mp3',
        bonus_pay: 'sounds/bonus_pay.mp3'
      };
      Object.keys(soundFiles).forEach(key => {
        fetch(soundFiles[key]).then(res => res.ok ? res.arrayBuffer() : Promise.reject())
          .then(buf => this.ctx.decodeAudioData(buf)).then(decoded => { this.audioBuffers[key] = decoded; })
          .catch(() => {});
      });
    },

    play: function(type) {
      if (!soundOn) return;
      this.init();
      if (this.audioBuffers[type]) {
        try {
          const source = this.ctx.createBufferSource();
          source.buffer = this.audioBuffers[type];
          source.connect(this.masterGain);
          source.start(0);
          return;
        } catch(e) {}
      }
      
      // 合成音フォールバック
      try {
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.connect(gain); gain.connect(this.masterGain);
        
        if (type === 'lever') {
          osc.type = 'triangle'; osc.frequency.setValueAtTime(340, now); osc.frequency.exponentialRampToValueAtTime(70, now + 0.08);
          gain.gain.setValueAtTime(0.5, now); gain.gain.linearRampToValueAtTime(0.01, now + 0.08);
          osc.start(now); osc.stop(now + 0.08);
        } else if (type === 'stop') {
          osc.type = 'sine'; osc.frequency.setValueAtTime(180, now); osc.frequency.exponentialRampToValueAtTime(40, now + 0.06);
          gain.gain.setValueAtTime(0.6, now); gain.gain.linearRampToValueAtTime(0.01, now + 0.06);
          osc.start(now); osc.stop(now + 0.06);
        } else if (type === 'gako') {
          osc.type = 'square'; osc.frequency.setValueAtTime(800, now);
          gain.gain.setValueAtTime(0.8, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
          osc.start(now); osc.stop(now + 0.15);
        } else if (type === 'big_fanfare' || type === 'reg_fanfare') {
          osc.type = 'triangle'; osc.frequency.setValueAtTime(523.25, now);
          gain.gain.setValueAtTime(0.3, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
          osc.start(now); osc.stop(now + 0.5);
        } else if (type === 'grape' || type === 'bonus_pay') {
          osc.type = 'sine'; osc.frequency.setValueAtTime(659.25, now); osc.frequency.setValueAtTime(880.00, now + 0.05); osc.frequency.setValueAtTime(1046.50, now + 0.1);
          gain.gain.setValueAtTime(0.3, now); gain.gain.linearRampToValueAtTime(0, now + 0.2);
          osc.start(now); osc.stop(now + 0.2);
        } else if (type === 'cherry') {
          osc.type = 'square'; osc.frequency.setValueAtTime(440, now);
          gain.gain.setValueAtTime(0.4, now); gain.gain.setValueAtTime(0, now + 0.05); gain.gain.setValueAtTime(0.4, now + 0.1); gain.gain.setValueAtTime(0, now + 0.15);
          osc.start(now); osc.stop(now + 0.15);
        } else if (type === 'replay') {
          osc.type = 'triangle'; osc.frequency.setValueAtTime(300, now); osc.frequency.linearRampToValueAtTime(800, now + 0.3);
          gain.gain.setValueAtTime(0.4, now); gain.gain.linearRampToValueAtTime(0, now + 0.3);
          osc.start(now); osc.stop(now + 0.3);
        } else if (type === 'bell_clown') {
          osc.type = 'triangle'; osc.frequency.setValueAtTime(1200, now); osc.frequency.linearRampToValueAtTime(1400, now + 0.1); osc.frequency.linearRampToValueAtTime(1200, now + 0.2);
          gain.gain.setValueAtTime(0.3, now); gain.gain.linearRampToValueAtTime(0, now + 0.3);
          osc.start(now); osc.stop(now + 0.3);
        }
      } catch(e) {}
    },

    // 【新規】ボーナス中BGMメロディループ (軍艦マーチ風 ＆ 落ち着きテンポ)
    playBGM: function(type) {
      if (!soundOn) return;
      this.init();
      this.stopBGM();
      isPlayingBGM = true;
      currentBgmType = type;
      
      const melodyBIG = [
        [392.00, 150], [392.00, 150], [392.00, 150], [392.00, 300],
        [329.63, 300], [261.63, 300], [196.00, 300], [329.63, 300], [261.63, 300], [196.00, 300],
        [329.63, 300], [261.63, 300], [261.63, 600]
      ];
      const melodyREG = [
        [261.63, 300], [261.63, 300], [392.00, 300], [392.00, 300], 
        [440.00, 300], [440.00, 300], [392.00, 600]
      ];
      
      const melody = type === 'BIG' ? melodyBIG : melodyREG;
      let noteIndex = 0;
      
      const playNextNote = () => {
        if (!isPlayingBGM || !soundOn || currentBgmType !== type) return;
        
        const note = melody[noteIndex];
        const freq = note[0];
        const dur = note[1];
        
        try {
          const now = this.ctx.currentTime;
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          
          osc.type = type === 'BIG' ? 'square' : 'triangle';
          osc.frequency.value = freq;
          
          gain.gain.setValueAtTime(0, now);
          gain.gain.linearRampToValueAtTime(0.2, now + 0.02); // 立ち上がり
          gain.gain.linearRampToValueAtTime(0, now + (dur / 1000) - 0.02); // 減衰
          
          osc.connect(gain);
          gain.connect(this.bgmGain);
          
          osc.start(now);
          osc.stop(now + (dur / 1000));
        } catch(e) {}
        
        noteIndex = (noteIndex + 1) % melody.length;
        this.bgmTimer = setTimeout(playNextNote, dur);
      };
      playNextNote();
    },

    stopBGM: function() {
      isPlayingBGM = false;
      currentBgmType = null;
      if (this.bgmTimer) {
        clearTimeout(this.bgmTimer);
        this.bgmTimer = null;
      }
    }
  };

  // ===================================================
  // 2. 7セグ表示制御
  // ===================================================
  const SEGMENT_MAP = {
    '0': ['a','b','c','d','e','f'], '1': ['b','c'], '2': ['a','b','d','e','g'],
    '3': ['a','b','c','d','g'], '4': ['b','c','f','g'], '5': ['a','c','d','f','g'],
    '6': ['a','c','d','e','f','g'], '7': ['a','b','c'], '8': ['a','b','c','d','e','f','g'],
    '9': ['a','b','c','d','f','g'], '-': ['g'], ' ': []
  };

  function update7SegDisplay(containerId, value, digits = 2) {
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
        if (elem.classList) elem.classList.forEach(cls => { if (cls.startsWith('seg-')) segName = cls.replace('seg-', ''); });
        elem.classList.toggle('lit', litSegs.includes(segName));
      });
    }
  }

  // ===================================================
  // 3. 限界突破 105%透過描画 (白枠完全撤去)
  // ===================================================
  function decodeRLEToCanvasPrecisionCrop(symData) {
    const rawCvs = document.createElement('canvas');
    rawCvs.width = 128; rawCvs.height = 128;
    const rawCtx = rawCvs.getContext('2d');
    rawCtx.clearRect(0, 0, 128, 128);

    if (!symData || !symData.rle) return { canvas: rawCvs, crop: { x: 0, y: 22, w: 128, h: 84 } };

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
      const isWhite = (hexLower === '#ffffff' || hexLower === '#fff' || hexLower === '#ffffffff');
      
      const r = parseInt(hex.substring(1, 3), 16) || 255;
      const g = parseInt(hex.substring(3, 5), 16) || 255;
      const b = parseInt(hex.substring(5, 7), 16) || 255;
      const a = isWhite ? 0 : 255;

      for (let c = 0; c < count; c++) {
        const idx = pixelIndex * 4;
        data[idx] = r; data[idx+1] = g; data[idx+2] = b; data[idx+3] = a;
        pixelIndex++;
      }
    }
    rawCtx.putImageData(imgData, symData.x, symData.y);
    return { canvas: rawCvs, crop: { x: 0, y: 22, w: 128, h: 84 } };
  }

  function initSymbolCache() {
    const ALL_IDS = ['7', 'BAR', 'GRAPE', 'CHERRY', 'BELL', 'RHINO', 'CLOWN'];
    const dataStore = window.SLOT_SYMBOLS_DATA || {};
    ALL_IDS.forEach(id => {
      symbolCanvasCache[id] = dataStore[id] ? decodeRLEToCanvasPrecisionCrop(dataStore[id]) : decodeRLEToCanvasPrecisionCrop(null);
    });
  }

  function drawSymbol(ctx, type, y, isReelSpinning = false) {
    const cached = symbolCanvasCache[type];
    if (!cached) return;
    ctx.save();
    ctx.translate(0, y);

    // 【限界突破デザイン】赤7とBARはコマ高(46px)に対して「105%」拡大。他の小役は85%に抑える。
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
  }

  // ===================================================
  // 4. UI ＆ ランプ更新
  // ===================================================
  function updateDisplays(payout = 0) {
    if (internalCredits < 3 && !isBonusMode) internalCredits = 50;
    credits = Math.min(50, internalCredits);

    update7SegDisplay('creditDisp', credits, 2);
    update7SegDisplay('countDisp', isBonusMode ? bonusAcquired : 0, 3);
    update7SegDisplay('payoutDisp', payout, 2);

    const lampReplay = document.getElementById('lampReplay');
    const lampStart = document.getElementById('lampStart');

    if (lampReplay) lampReplay.classList.toggle('active', isReplay);
    const canPlay = isReplay || (isBonusMode ? internalCredits >= 1 : internalCredits >= 3);
    if (lampStart) lampStart.classList.toggle('active', gameState === STATE_IDLE && canPlay);

    const mainCabinet = document.getElementById('mainCabinet');
    if (mainCabinet) {
      if (isBonusMode) mainCabinet.classList.add('bonus-mode');
      else mainCabinet.classList.remove('bonus-mode');
    }

    if (window.DATA_COUNTER) {
      const stats = window.DATA_COUNTER.getStats();
      const diffEl = document.getElementById('barDiffMedal');
      if (diffEl) {
        diffEl.textContent = (stats.diffMedal > 0 ? '+' : '') + stats.diffMedal;
        diffEl.style.color = stats.diffMedal >= 0 ? '#00e5ff' : '#ff9900';
      }
      const gEl = document.getElementById('barGames'); if(gEl) gEl.textContent = stats.currentGames + 'G';
      const bEl = document.getElementById('barBigCount'); if(bEl) bEl.textContent = stats.bigCount;
      const rEl = document.getElementById('barRegCount'); if(rEl) rEl.textContent = stats.regCount;
      const pEl = document.getElementById('barTotalProb'); if(pEl) pEl.textContent = stats.totalProb; // 合成確率
    }
  }

  function setLineBadgesLit(isLit) {
    const b1 = document.querySelector('.line-badge.badge-1');
    const b2 = document.querySelector('.line-badge.badge-2');
    const b3 = document.querySelector('.line-badge.badge-3');
    if (!b1 || !b2 || !b3) return;

    if (isLit) {
      if (isBonusMode) {
        b1.classList.remove('lit'); b2.classList.add('lit'); b3.classList.remove('lit');
      } else {
        b1.classList.add('lit'); b2.classList.add('lit'); b3.classList.add('lit');
      }
    } else {
      b1.classList.remove('lit'); b2.classList.remove('lit'); b3.classList.remove('lit');
    }
  }

  function triggerPeka() {
    if (isPeka) return;
    isPeka = true;
    const gogoBox = document.getElementById('gogoBox');
    if (gogoBox) gogoBox.classList.add('peka');
    SoundEngine.play('gako');
    if (isAutoMode) stopAutoMode();
  }

  function turnOffGogoLamp() {
    isPeka = false;
    const gogoBox = document.getElementById('gogoBox');
    if (gogoBox) gogoBox.classList.remove('peka');
  }

  function stopAutoMode() {
    isAutoMode = false;
    clearTimeout(autoTimer);
    const btn = document.getElementById('autoToggleBtn');
    if (btn) { btn.textContent = '👤 MODE: MANUAL'; btn.classList.remove('active'); }
  }

  function triggerLeverVisual() {
    const startBtn = document.getElementById('startBtn');
    if (startBtn) {
      startBtn.classList.add('hit');
      setTimeout(() => startBtn.classList.remove('hit'), 150);
    }
  }

  // ===================================================
  // 5. グローバルスロットエンジン (実機フラグ・超爽快アシスト・リセット搭載)
  // ===================================================
  window.JUGGLER_ENGINE = {
    isInitialized: false,
    
    init: function() {
      if (this.isInitialized) return;
      initSymbolCache();

      reels = REEL_STRIPS.map((strip, idx) => {
        const canvas = document.getElementById(`reelCanvas${idx}`);
        if (!canvas) return null;
        canvas.width = CANVAS_WIDTH; canvas.height = SYMBOL_HEIGHT * strip.length * 3;
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

      setLineBadgesLit(true);
      updateDisplays();
      this.bindEvents();
      this.isInitialized = true;
    },

    // 【新規】遊技完全リセット機能
    resetGame: function() {
      gameState = STATE_IDLE;
      activeReelsCount = 0;
      isTouchActive = false;
      hasActionExecutedInCurrentTouch = false;
      
      internalCredits = 50;
      betAmount = 0;
      isAutoMode = false;
      clearTimeout(autoTimer);
      
      currentFlag = null;
      bonusFlag = null;
      isBonusMode = false;
      bonusType = null;
      bonusAcquired = 0;
      isPeka = false;
      pekaTiming = null;
      isReplay = false;
      
      SoundEngine.stopBGM();
      turnOffGogoLamp();
      
      reels.forEach(reel => {
        reel.isSpinning = false;
        reel.isStopping = false;
        cancelAnimationFrame(reel.animId);
        const currentIdx = Math.floor(Math.random() * reel.strip.length);
        reel.currentIndex = currentIdx;
        reel.pos = currentIdx * SYMBOL_HEIGHT;
        reel.canvas.style.transform = `translateY(-${reel.pos}px)`;
        this.renderReelCanvas(reel, false);
        
        const btn = document.getElementById(`stopBtn${reel.id}`);
        if(btn) { btn.disabled = true; btn.classList.remove('spinning'); }
      });
      
      const autoToggleBtn = document.getElementById('autoToggleBtn');
      if(autoToggleBtn) {
        autoToggleBtn.textContent = '👤 MODE: MANUAL';
        autoToggleBtn.classList.remove('active');
      }
      
      setLineBadgesLit(true);
      updateDisplays(0);
    },

    getConfig: function() { return { setting: currentSetting, autoStopOnBonus: autoStopOnBonus, weightCut: weightCut, volume: masterVolume, soundOn: soundOn }; },
    
    // 【最重要】設定適用時のサウンド即時Unlock対応
    setConfig: function(config) {
      if (config.setting !== undefined) currentSetting = config.setting;
      if (config.autoStopOnBonus !== undefined) autoStopOnBonus = config.autoStopOnBonus;
      if (config.weightCut !== undefined) weightCut = config.weightCut;
      if (config.volume !== undefined) SoundEngine.setVolume(config.volume);
      if (config.soundOn !== undefined) {
        soundOn = config.soundOn;
        if (soundOn) {
          SoundEngine.unlock(); // ブラウザのAudio制約を強制突破
          if (isBonusMode && !isPlayingBGM) SoundEngine.playBGM(bonusType);
        } else {
          SoundEngine.stopBGM();
        }
      }
    },

    renderReelCanvas: function(reel, isSpinning) {
      const tripleStrip = [...reel.strip, ...reel.strip, ...reel.strip];
      reel.ctx.clearRect(0, 0, reel.canvas.width, reel.canvas.height);
      tripleStrip.forEach((sym, i) => { drawSymbol(reel.ctx, sym, i * SYMBOL_HEIGHT, isSpinning); });
    },

    drawFlag: function() {
      if (isBonusMode) return 'GRAPE'; 
      if (bonusFlag) return bonusFlag;

      const r = Math.random();
      const prob = PROBABILITY_TABLE[currentSetting];
      let accum = 0;
      
      accum += prob.sBIG; if (r < accum) return 'BIG';
      accum += prob.sREG; if (r < accum) return 'REG';
      accum += prob.cBIG; if (r < accum) return 'CHERRY_BIG';
      accum += prob.cREG; if (r < accum) return 'CHERRY_REG';
      accum += PROB_REPLAY; if (r < accum) return 'REPLAY';
      accum += prob.grape; if (r < accum) return 'GRAPE';
      
      const sCherryProb = prob.cherry - prob.cBIG - prob.cREG;
      accum += sCherryProb; if (r < accum) return 'CHERRY';
      
      accum += PROB_BELL; if (r < accum) return 'BELL';
      accum += PROB_CLOWN; if (r < accum) return 'CLOWN';

      return null;
    },

    startSpin: function() {
      if (gameState !== STATE_IDLE) return;

      try {
        const canPlay = isReplay || (isBonusMode ? internalCredits >= 1 : internalCredits >= 3);
        if (!canPlay && internalCredits < 3) internalCredits = 50; 

        gameState = STATE_SPINNING;
        activeReelsCount = 3;
        hasActionExecutedInCurrentTouch = true;
        spinStartTime = Date.now();

        SoundEngine.init();
        triggerLeverVisual();

        setLineBadgesLit(false);
        updateDisplays(0);

        const lampWait = document.getElementById('lampWait');
        if (lampWait) {
          lampWait.classList.add('active');
          setTimeout(() => lampWait.classList.remove('active'), 250);
        }

        if (isBonusMode) {
          betAmount = 1; internalCredits -= 1;
          if (window.DATA_COUNTER) window.DATA_COUNTER.onGameStart(1, true);
        } else if (!isReplay) {
          internalCredits -= 3; betAmount = 3;
          if (window.DATA_COUNTER) window.DATA_COUNTER.onGameStart(3, false);
        } else {
          betAmount = 3; isReplay = false;
          if (window.DATA_COUNTER) window.DATA_COUNTER.onGameStart(0, false);
        }

        SoundEngine.play('lever');
        
        currentFlag = this.drawFlag();
        
        if (currentFlag === 'BIG' || currentFlag === 'REG' || currentFlag === 'CHERRY_BIG' || currentFlag === 'CHERRY_REG') {
          if (!bonusFlag) {
            bonusFlag = currentFlag;
            if (currentFlag === 'CHERRY_BIG' || currentFlag === 'CHERRY_REG') {
              pekaTiming = 'STOP3_UP';
            } else {
              const pekaRand = Math.random();
              if (pekaRand < 0.25) pekaTiming = 'LEVER';
              else if (pekaRand < 0.35) pekaTiming = 'STOP1';
              else if (pekaRand < 0.50) pekaTiming = 'STOP3_DOWN';
              else pekaTiming = 'STOP3_UP';
            }
          }
        }

        if (!isBonusMode && bonusFlag && pekaTiming === 'LEVER') triggerPeka();

        const spinSpeed = (isPeka && !isBonusMode) ? REEL_SPEED_SLOW : REEL_SPEED_NORMAL;

        reels.forEach((reel, i) => {
          reel.isSpinning = true;
          reel.isStopping = false;
          reel.speed = spinSpeed; 
          this.renderReelCanvas(reel, true); 
          this.spinReel(reel);
          const btn = document.getElementById(`stopBtn${i}`);
          if (btn) { btn.disabled = false; btn.classList.add('spinning'); }
        });

        if (isAutoMode) this.scheduleAutoStop();

      } catch (e) {
        gameState = STATE_IDLE; 
      }
    },

    stopReelIndex: function(index, isAutoCall = false) {
      if (gameState !== STATE_SPINNING) return;
      if (!isAutoCall && isTouchActive && hasActionExecutedInCurrentTouch) return;

      const reel = reels[index];
      if (!reel || !reel.isSpinning || reel.isStopping) return;

      try {
        reel.isStopping = true;
        activeReelsCount--;
        if (!isAutoCall) hasActionExecutedInCurrentTouch = true;

        const btn = document.getElementById(`stopBtn${index}`);
        if (btn) { btn.disabled = true; btn.classList.remove('spinning'); }
        SoundEngine.play('stop');

        if (!isBonusMode && index === 0 && bonusFlag && pekaTiming === 'STOP1') triggerPeka();
        if (!isBonusMode && index === 2 && bonusFlag && pekaTiming === 'STOP3_DOWN') triggerPeka();

        const maxPos = reel.strip.length * SYMBOL_HEIGHT;
        let baseIdx = Math.floor(reel.pos / SYMBOL_HEIGHT) % reel.strip.length;
        if (baseIdx < 0) baseIdx += reel.strip.length;
        let targetIdx = baseIdx;

        let targetSyms = [];
        
        if (isBonusMode) {
          targetSyms = ['GRAPE'];
        } else {
          if (currentFlag === 'BIG') targetSyms = ['7'];
          else if (currentFlag === 'REG') targetSyms = index === 2 ? ['BAR'] : ['7'];
          else if (currentFlag === 'CHERRY_BIG' || currentFlag === 'CHERRY_REG' || currentFlag === 'CHERRY') targetSyms = ['CHERRY'];
          else if (currentFlag === 'REPLAY') targetSyms = ['RHINO'];
          else if (currentFlag === 'GRAPE') targetSyms = ['GRAPE'];
          else if (currentFlag === 'BELL') targetSyms = ['BELL'];
          else if (currentFlag === 'CLOWN') targetSyms = ['CLOWN'];
          else if (!currentFlag && bonusFlag) {
            // ハズレかつボーナス成立中（超アシスト対象）
            if (bonusFlag === 'BIG' || bonusFlag === 'CHERRY_BIG') targetSyms = ['7'];
            else if (bonusFlag === 'REG' || bonusFlag === 'CHERRY_REG') targetSyms = index === 2 ? ['BAR'] : ['7'];
          }
        }

        // 【極上の爽快感】ボーナス消化中 または ボーナス成立時のハズレ目 は21コマ滑らせて絶対揃える
        let slipLimit = 4;
        if (isBonusMode || (!currentFlag && bonusFlag && (targetSyms.includes('7') || targetSyms.includes('BAR')))) {
          slipLimit = 21; 
        }
        
        let found = false;
        
        if (targetSyms.length > 0) {
          for (let slip = 0; slip <= slipLimit; slip++) {
            const checkTopIdx = (baseIdx - slip + reel.strip.length) % reel.strip.length;
            const checkLines = (isBonusMode || betAmount === 1) ? [1] : [0, 1, 2];
            for (let offset of checkLines) {
              if (targetSyms.includes(reel.strip[(checkTopIdx + offset) % reel.strip.length])) {
                targetIdx = checkTopIdx; found = true; break;
              }
            }
            if (found) break;
          }
        }
        
        reel.currentIndex = targetIdx;
        reel.targetPos = targetIdx * SYMBOL_HEIGHT;

        if (index === 2 && !isBonusMode && bonusFlag && pekaTiming === 'STOP3_UP') triggerPeka();
      } catch (e) {}
    },

    handleTap: function() {
      if (!this.isInitialized) return;
      if (gameState === STATE_IDLE) {
        this.startSpin();
      } else if (gameState === STATE_SPINNING) {
        for (let i = 0; i < 3; i++) {
          if (reels[i].isSpinning && !reels[i].isStopping) {
            this.stopReelIndex(i, false);
            break;
          }
        }
      }
    },

    bindEvents: function() {
      const startTouchSession = () => { isTouchActive = true; };
      const endTouchSession = () => { isTouchActive = false; hasActionExecutedInCurrentTouch = false; };

      document.addEventListener('touchstart', startTouchSession, { passive: true });
      document.addEventListener('touchend', endTouchSession, { passive: true });
      document.addEventListener('touchcancel', endTouchSession, { passive: true });
      document.addEventListener('mousedown', startTouchSession, { passive: true });
      document.addEventListener('mouseup', endTouchSession, { passive: true });

      const autoToggleBtn = document.getElementById('autoToggleBtn');
      if (autoToggleBtn) {
        const toggleAuto = (e) => {
          if (e) { e.stopPropagation(); if (e.cancelable) e.preventDefault(); }
          isAutoMode = !isAutoMode;
          autoToggleBtn.textContent = isAutoMode ? '🤖 AUTO: ON' : '👤 MODE: MANUAL';
          autoToggleBtn.classList.toggle('active', isAutoMode);
          if (isAutoMode && gameState === STATE_IDLE) this.startSpin();
        };
        autoToggleBtn.addEventListener('touchstart', toggleAuto, { passive: false });
        autoToggleBtn.addEventListener('click', toggleAuto);
      }
    },

    scheduleAutoStop: function() {
      if (!isAutoMode) return;
      clearTimeout(autoTimer);
      autoTimer = setTimeout(() => {
        if (reels[0].isSpinning) this.stopReelIndex(0, true);
        autoTimer = setTimeout(() => {
          if (reels[1].isSpinning) this.stopReelIndex(1, true);
          autoTimer = setTimeout(() => {
            if (reels[2].isSpinning) this.stopReelIndex(2, true);
          }, 200);
        }, 200);
      }, 220);
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
            this.renderReelCanvas(reel, false);
            if (activeReelsCount === 0) this.onAllStopped();
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

    onAllStopped: function() {
      gameState = STATE_IDLE; 
      betAmount = 0;
      
      const getSym = (rIdx, offset) => {
        const strip = reels[rIdx].strip;
        return strip[(reels[rIdx].currentIndex + offset + strip.length) % strip.length];
      };

      const lines = [
        [getSym(0, 0), getSym(1, 0), getSym(2, 0)],
        [getSym(0, 1), getSym(1, 1), getSym(2, 1)],
        [getSym(0, 2), getSym(1, 2), getSym(2, 2)],
        [getSym(0, 0), getSym(1, 1), getSym(2, 2)],
        [getSym(0, 2), getSym(1, 1), getSym(2, 0)]
      ];

      let activeLines = [];
      if (isBonusMode) activeLines = [lines[1]];
      else activeLines = lines;

      let payout = 0;
      let isBigWin = false, isRegWin = false, isReplayWin = false;
      let playSoundType = 'bonus_pay';
      let grapeWin = false, cherryWin = false, bellWin = false, clownWin = false;

      // 有効ライン上に実際に役が「揃っているか」を厳格判定
      activeLines.forEach(line => {
        if (line.every(s => s === '7')) isBigWin = true;
        else if (line[0] === '7' && line[1] === '7' && line[2] === 'BAR') isRegWin = true;
        else if (line.every(s => s === 'RHINO')) isReplayWin = true;
        else if (line.every(s => s === 'GRAPE')) grapeWin = true;
        else if (line[0] === 'CHERRY') cherryWin = true;
        else if (line.every(s => s === 'BELL')) bellWin = true;
        else if (line.every(s => s === 'CLOWN')) clownWin = true;
      });

      // 【ごまかし排除】実際に揃った場合のみPAYOUT枚数を決定 (REGは13枚)
      if (grapeWin) { 
        payout = isBonusMode ? (bonusType === 'BIG' ? 15 : 13) : 8; 
        playSoundType = 'grape'; 
      }
      if (cherryWin && !isBonusMode) { payout = Math.max(payout, 2); playSoundType = 'cherry'; }
      if (bellWin && !isBonusMode) { payout = Math.max(payout, 14); playSoundType = 'bell_clown'; }
      if (clownWin && !isBonusMode) { payout = Math.max(payout, 10); playSoundType = 'bell_clown'; }

      if (payout > 0) {
        internalCredits += payout;
        if (window.DATA_COUNTER) {
          window.DATA_COUNTER.onPayout(payout, grapeWin ? (isBonusMode ? 'BONUS_GRAPE' : 'GRAPE') : 'OTHER');
        }
        SoundEngine.play(playSoundType);
      }

      if (isBonusMode) {
        if (payout > 0) bonusAcquired += payout;
        
        // 【終了条件完全適正化】BIG:266枚払出(純増252) / REG:98枚払出(純増96)
        if (bonusAcquired >= bonusTarget) {
          isBonusMode = false;
          bonusFlag = null; 
          currentFlag = null;
          SoundEngine.stopBGM(); // 【BGM停止】
        }
        setLineBadgesLit(true);
        updateDisplays(payout);
        if (isAutoMode) setTimeout(() => { if (isAutoMode) this.startSpin(); }, 400);
        return;
      }

      if (isBigWin) {
        isBonusMode = true; bonusType = 'BIG'; bonusAcquired = 0; bonusTarget = 266;
        bonusFlag = null; currentFlag = null; 
        if (window.DATA_COUNTER) window.DATA_COUNTER.onBonusWin('BIG');
        turnOffGogoLamp();
        SoundEngine.play('big_fanfare');
        setTimeout(() => { SoundEngine.playBGM('BIG'); }, 1500); // ファンファーレ後にBGM開始
        if (autoStopOnBonus) stopAutoMode();
      } else if (isRegWin) {
        isBonusMode = true; bonusType = 'REG'; bonusAcquired = 0; bonusTarget = 98;
        bonusFlag = null; currentFlag = null;
        if (window.DATA_COUNTER) window.DATA_COUNTER.onBonusWin('REG');
        turnOffGogoLamp();
        SoundEngine.play('reg_fanfare');
        setTimeout(() => { SoundEngine.playBGM('REG'); }, 1500); // ファンファーレ後にBGM開始
        if (autoStopOnBonus) stopAutoMode();
      } else if (isReplayWin) {
        isReplay = true;
        SoundEngine.play('replay');
      }

      currentFlag = null;
      setLineBadgesLit(true);
      updateDisplays(payout);

      if (isAutoMode) {
        setTimeout(() => {
          if (isAutoMode && gameState === STATE_IDLE) this.startSpin();
        }, isReplayWin ? 150 : 450);
      }
    }
  };
})();


