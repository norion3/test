/**
 * スロットゲームエンジン (engine.js)
 * ペカリ時スロー旋回・超アシスト目押し・全画面タップ進行・縦幅100%密着描画・デフォルトWaitなし
 */

(function() {
  // 21コマの実機リール配列定義
  const REEL_STRIPS = [
    ['BAR', 'GRAPE', 'RHINO', 'GRAPE', 'BELL', '7', 'RHINO', 'GRAPE', 'RHINO', 'GRAPE', 'BAR', 'CHERRY', 'GRAPE', 'RHINO', 'GRAPE', '7', 'CLOWN', 'GRAPE', 'RHINO', 'GRAPE', 'CHERRY'],
    ['RHINO', 'BELL', 'GRAPE', 'CHERRY', 'RHINO', '7', 'GRAPE', 'CHERRY', 'RHINO', 'BELL', 'GRAPE', 'CHERRY', 'RHINO', 'BAR', 'GRAPE', 'CHERRY', 'CLOWN', 'RHINO', '7', 'GRAPE', 'CHERRY'],
    ['GRAPE', 'CLOWN', 'BELL', 'RHINO', 'GRAPE', '7', 'BAR', 'BELL', 'RHINO', 'GRAPE', 'CLOWN', 'BELL', 'RHINO', 'GRAPE', 'CLOWN', 'BELL', 'RHINO', 'GRAPE', 'CLOWN', 'BELL', 'RHINO']
  ];

  // リールコマサイズ (横幅100px × 高さ75px)
  const SYMBOL_HEIGHT = 75;
  const CANVAS_WIDTH = 100;
  const REEL_SPEED_NORMAL = 36; // 通常時スピード
  const REEL_SPEED_SLOW = 12;   // ペカリ（点灯）時の超低速スロー旋回スピード

  // SアイムジャグラーEX 実機確率テーブル (設定1〜6)
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
  let autoStopOnBonus = true;  // ボーナス成立時にAUTO解除して手動復帰
  let weightCut = true;        // デフォルトでウェイトカットON (Waitなし)
  let masterVolume = 1.0;      // 全体音量 (0.0 〜 1.0)

  let credits = 50;            // 表示クレジット（上限50固定）
  let internalCredits = 50;    // 内部保持クレジット
  let betAmount = 0;
  let isSpinning = false;
  let isAutoMode = false;
  let autoTimer = null;
  let lastSpinTime = 0;
  let isWaiting = false;

  // ボーナス状態
  let bonusFlag = null;         // 'BIG' | 'REG' | null
  let isBonusMode = false;      // ボーナス消化モード
  let bonusType = null;         // 'BIG' | 'REG'
  let bonusAcquired = 0;        // 純増獲得枚数
  let bonusTarget = 0;          // BIG: 252枚 / REG: 96枚

  let isPeka = false;
  let pekaTiming = null;        // 'LEVER' | 'STOP1' | 'STOP3_DOWN' | 'STOP3_UP'
  let isReplay = false;
  let soundOn = true;
  let reels = [];

  const symbolCanvasCache = {};

  // ===================================================
  // 1. 高度リアル音響エンジン (DSP + Master Volume)
  // ===================================================
  const SoundEngine = {
    ctx: null,
    masterGain: null,
    audioBuffers: {},

    init: function() {
      if (!this.ctx) {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.setValueAtTime(soundOn ? masterVolume : 0, this.ctx.currentTime);
        this.masterGain.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      this.loadExternalSounds();
    },

    setVolume: function(vol) {
      masterVolume = vol;
      if (this.masterGain && this.ctx) {
        this.masterGain.gain.setValueAtTime(soundOn ? masterVolume : 0, this.ctx.currentTime);
      }
    },

    loadExternalSounds: function() {
      const soundFiles = {
        bet: 'sounds/bet.mp3',
        lever: 'sounds/lever.mp3',
        stop: 'sounds/stop.mp3',
        gako: 'sounds/gako.mp3',
        grape: 'sounds/grape.mp3',
        cherry: 'sounds/cherry.mp3',
        replay: 'sounds/replay.mp3',
        bell_clown: 'sounds/bell_clown.mp3',
        big_fanfare: 'sounds/big_fanfare.mp3',
        reg_fanfare: 'sounds/reg_fanfare.mp3',
        bonus_pay: 'sounds/bonus_pay.mp3'
      };

      Object.keys(soundFiles).forEach(key => {
        fetch(soundFiles[key])
          .then(res => {
            if (!res.ok) throw new Error('File not found');
            return res.arrayBuffer();
          })
          .then(buf => this.ctx.decodeAudioData(buf))
          .then(decoded => { this.audioBuffers[key] = decoded; })
          .catch(() => { /* MP3が無い場合はWebAudio内蔵音へ自動フォールバック */ });
      });
    },

    play: function(type) {
      if (!soundOn) return;
      this.init();

      if (this.audioBuffers[type]) {
        const source = this.ctx.createBufferSource();
        source.buffer = this.audioBuffers[type];
        source.connect(this.masterGain);
        source.start(0);
        return;
      }

      const now = this.ctx.currentTime;

      if (type === 'bet') {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1200, now);
        osc.frequency.exponentialRampToValueAtTime(2400, now + 0.05);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
        osc.connect(gain); gain.connect(this.masterGain);
        osc.start(now); osc.stop(now + 0.05);
      } 
      else if (type === 'lever') {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(340, now);
        osc.frequency.exponentialRampToValueAtTime(70, now + 0.08);
        gain.gain.setValueAtTime(0.5, now);
        gain.gain.linearRampToValueAtTime(0.01, now + 0.08);
        osc.connect(gain); gain.connect(this.masterGain);
        osc.start(now); osc.stop(now + 0.08);
      } 
      else if (type === 'stop') {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(180, now);
        osc.frequency.exponentialRampToValueAtTime(40, now + 0.06);
        gain.gain.setValueAtTime(0.6, now);
        gain.gain.linearRampToValueAtTime(0.01, now + 0.06);
        osc.connect(gain); gain.connect(this.masterGain);
        osc.start(now); osc.stop(now + 0.06);
      } 
      else if (type === 'gako') {
        const bufferSize = this.ctx.sampleRate * 0.15;
        const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const output = noiseBuffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
          output[i] = Math.random() * 2 - 1;
        }
        const whiteNoise = this.ctx.createBufferSource();
        whiteNoise.buffer = noiseBuffer;

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(250, now);
        filter.frequency.exponentialRampToValueAtTime(50, now + 0.15);

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(1.0, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);

        whiteNoise.connect(filter);
        filter.connect(gain);
        gain.connect(this.masterGain);
        whiteNoise.start(now);

        const subOsc = this.ctx.createOscillator();
        const subGain = this.ctx.createGain();
        subOsc.type = 'sine';
        subOsc.frequency.setValueAtTime(90, now);
        subOsc.frequency.exponentialRampToValueAtTime(30, now + 0.15);
        subGain.gain.setValueAtTime(0.9, now);
        subGain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
        subOsc.connect(subGain); subGain.connect(this.masterGain);
        subOsc.start(now); subOsc.stop(now + 0.15);
      } 
      else if (type === 'grape' || type === 'bonus_pay') {
        [523.25, 659.25, 783.99, 1046.50].forEach((freq, idx) => {
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now + idx * 0.03);
          gain.gain.setValueAtTime(0.2, now + idx * 0.03);
          gain.gain.exponentialRampToValueAtTime(0.01, now + idx * 0.03 + 0.08);
          osc.connect(gain); gain.connect(this.masterGain);
          osc.start(now + idx * 0.03); osc.stop(now + idx * 0.03 + 0.08);
        });
      } 
      else if (type === 'replay') {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.setValueAtTime(1760, now + 0.06);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.linearRampToValueAtTime(0.01, now + 0.12);
        osc.connect(gain); gain.connect(this.masterGain);
        osc.start(now); osc.stop(now + 0.12);
      }
      else if (type === 'big_fanfare' || type === 'reg_fanfare') {
        const notes = type === 'big_fanfare' 
          ? [523.25, 659.25, 783.99, 1046.50, 1318.51] 
          : [440.00, 554.37, 659.25, 880.00];
        notes.forEach((freq, i) => {
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, now + i * 0.08);
          gain.gain.setValueAtTime(0.3, now + i * 0.08);
          gain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.08 + 0.3);
          osc.connect(gain); gain.connect(this.masterGain);
          osc.start(now + i * 0.08); osc.stop(now + i * 0.08 + 0.3);
        });
      }
    }
  };

  // ===================================================
  // 2. 本格7セグメントLED制御 (SVGポリゴン用)
  // ===================================================
  const SEGMENT_MAP = {
    '0': ['a','b','c','d','e','f'],
    '1': ['b','c'],
    '2': ['a','b','d','e','g'],
    '3': ['a','b','c','d','g'],
    '4': ['b','c','f','g'],
    '5': ['a','c','d','f','g'],
    '6': ['a','c','d','e','f','g'],
    '7': ['a','b','c'],
    '8': ['a','b','c','d','e','f','g'],
    '9': ['a','b','c','d','f','g'],
    '-': ['g'],
    ' ': []
  };

  function update7SegDisplay(containerId, value, digits = 2) {
    const container = document.getElementById(containerId);
    if (!container) return;

    let valStr = String(value);
    if (valStr.length < digits) {
      valStr = valStr.padStart(digits, ' ');
    }

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
        if (litSegs.includes(segName)) {
          elem.classList.add('lit');
        } else {
          elem.classList.remove('lit');
        }
      });
    }
  }

  // ===================================================
  // 3. 【最重要】縦幅100%フルフィット描画デコーダー
  // 上下の白い余白（隙間）を物理的に0pxにし、図柄同士を完全に接続
  // ===================================================
  function decodeRLEToCanvasPrecisionCrop(symData) {
    const rawCvs = document.createElement('canvas');
    rawCvs.width = 128; rawCvs.height = 128;
    const rawCtx = rawCvs.getContext('2d');
    rawCtx.fillStyle = '#ffffff'; rawCtx.fillRect(0, 0, 128, 128);

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
    rawCtx.putImageData(imgData, symData.x, symData.y);

    // 画像内の実コンテンツ領域（84px領域）を正確に抽出
    return {
      canvas: rawCvs,
      crop: { x: 0, y: 22, w: 128, h: 84 }
    };
  }

  function initSymbolCache() {
    const ALL_IDS = ['7', 'BAR', 'GRAPE', 'CHERRY', 'BELL', 'RHINO', 'CLOWN'];
    const dataStore = window.SLOT_SYMBOLS_DATA || {};

    ALL_IDS.forEach(id => {
      if (dataStore[id]) {
        symbolCanvasCache[id] = decodeRLEToCanvasPrecisionCrop(dataStore[id]);
      } else {
        const cvs = document.createElement('canvas');
        cvs.width = 128; cvs.height = 128;
        const ctx = cvs.getContext('2d');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 128, 128);
        ctx.fillStyle = '#000000'; ctx.font = 'bold 24px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(id, 64, 64);
        symbolCanvasCache[id] = { canvas: cvs, crop: { x: 0, y: 22, w: 128, h: 84 } };
      }
    });
  }

  // 1コマ描画（コマ高75pxに対して縦幅100%展開。上下白スペース0px）
  function drawSymbol(ctx, type, y, isReelSpinning = false) {
    const cached = symbolCanvasCache[type];
    ctx.save();
    ctx.translate(0, y);

    // 背景白
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, -0.5, CANVAS_WIDTH, SYMBOL_HEIGHT + 1.0);

    if (cached) {
      // 縦幅を1コマ高さ(75px)いっぱい(100%)にフィッティング配置
      let drawH = SYMBOL_HEIGHT; 
      let maxW = (type === '7' || type === 'BAR') ? CANVAS_WIDTH * 0.92 : CANVAS_WIDTH * 0.74;

      const scale = maxW / cached.crop.w;
      let drawW = cached.crop.w * scale;

      if (drawW > CANVAS_WIDTH * 0.94) {
        drawW = CANVAS_WIDTH * 0.94;
      }

      // 完全左右中央配置
      const drawX = (CANVAS_WIDTH - drawW) / 2;
      const drawY = 0; 

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      ctx.drawImage(cached.canvas, cached.crop.x, cached.crop.y, cached.crop.w, cached.crop.h, drawX, drawY, drawW, drawH);
    }
    ctx.restore();
  }

  // ディスプレイ＆7セグ＆データバー状態更新
  function updateDisplays(payout = 0) {
    if (internalCredits < 3 && !isBonusMode) {
      internalCredits = 50;
    }
    credits = Math.min(50, internalCredits);

    update7SegDisplay('creditDisp', credits, 2);
    update7SegDisplay('countDisp', isBonusMode ? bonusAcquired : 0, 2);
    update7SegDisplay('payoutDisp', payout, 2);

    const lampReplay = document.getElementById('lampReplay');
    const lampStart = document.getElementById('lampStart');
    const lampWait = document.getElementById('lampWait');

    if (lampReplay) lampReplay.classList.toggle('active', isReplay);
    if (lampStart) lampStart.classList.toggle('active', !isSpinning && (betAmount === 3 || isReplay || isBonusMode));
    if (lampWait) lampWait.classList.toggle('active', isWaiting);

    // 最下部データバーリアルタイム更新
    if (window.DATA_COUNTER) {
      const stats = window.DATA_COUNTER.getStats();
      const diffEl = document.getElementById('barDiffMedal');
      const bigEl = document.getElementById('barBigCount');
      const regEl = document.getElementById('barRegCount');
      const probEl = document.getElementById('barTotalProb');

      if (diffEl) {
        diffEl.textContent = (stats.diffMedal > 0 ? '+' : '') + stats.diffMedal;
        diffEl.style.color = stats.diffMedal >= 0 ? '#00e5ff' : '#ff9900';
      }
      if (bigEl) bigEl.textContent = stats.bigCount;
      if (regEl) regEl.textContent = stats.regCount;
      if (probEl) probEl.textContent = stats.totalProb;
    }
  }

  // リール左脇「①②③」有効ラインランプ（実機準拠動作）
  function setLineBadgesLit(isLit) {
    const badge1 = document.querySelector('.line-badge.badge-1');
    const badge2 = document.querySelector('.line-badge.badge-2');
    const badge3 = document.querySelector('.line-badge.badge-3');

    if (!badge1 || !badge2 || !badge3) return;

    if (isLit) {
      if (isBonusMode) {
        // ボーナス中(1BET時)は中段1ライン有効 ➔ 「②」ランプのみ点灯
        badge1.classList.remove('lit');
        badge2.classList.add('lit');
        badge3.classList.remove('lit');
      } else {
        // 通常時(3BET時)は5ライン有効 ➔ ①・②・③ 全点灯
        badge1.classList.add('lit');
        badge2.classList.add('lit');
        badge3.classList.add('lit');
      }
    } else {
      badge1.classList.remove('lit');
      badge2.classList.remove('lit');
      badge3.classList.remove('lit');
    }
  }

  // ペカリ発動 ＆ AUTO即時解除
  function triggerPeka() {
    if (isPeka) return;
    isPeka = true;
    const gogoBox = document.getElementById('gogoBox');
    if (gogoBox) gogoBox.classList.add('peka');
    SoundEngine.play('gako');

    if (isAutoMode) {
      stopAutoMode();
    }
  }

  // GOGO!ランプ消灯処理（ボーナス図柄揃い時）
  function turnOffGogoLamp() {
    isPeka = false;
    const gogoBox = document.getElementById('gogoBox');
    if (gogoBox) gogoBox.classList.remove('peka');
  }

  function stopAutoMode() {
    isAutoMode = false;
    clearTimeout(autoTimer);
    const autoToggleBtn = document.getElementById('autoToggleBtn');
    if (autoToggleBtn) {
      autoToggleBtn.textContent = '👤 MODE: MANUAL';
      autoToggleBtn.classList.remove('active');
    }
  }

  // ===================================================
  // 4. グローバルスロットエンジンオブジェクト
  // ===================================================
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

    getConfig: function() {
      return {
        setting: currentSetting,
        autoStopOnBonus: autoStopOnBonus,
        weightCut: weightCut,
        volume: masterVolume,
        soundOn: soundOn
      };
    },

    setConfig: function(config) {
      if (config.setting !== undefined) currentSetting = config.setting;
      if (config.autoStopOnBonus !== undefined) autoStopOnBonus = config.autoStopOnBonus;
      if (config.weightCut !== undefined) weightCut = config.weightCut;
      if (config.volume !== undefined) SoundEngine.setVolume(config.volume);
      if (config.soundOn !== undefined) soundOn = config.soundOn;
    },

    renderReelCanvas: function(reel, isSpinning) {
      const tripleStrip = [...reel.strip, ...reel.strip, ...reel.strip];
      reel.ctx.clearRect(0, 0, reel.canvas.width, reel.canvas.height);
      tripleStrip.forEach((sym, i) => { drawSymbol(reel.ctx, sym, i * SYMBOL_HEIGHT, isSpinning); });
    },

    startSpin: function() {
      if (isSpinning) return;

      const now = Date.now();
      const elapsed = now - lastSpinTime;
      const targetWait = weightCut ? 180 : 4100;

      if (lastSpinTime > 0 && elapsed < targetWait) {
        isWaiting = true;
        updateDisplays();
        setTimeout(() => {
          isWaiting = false;
          this.executeSpin();
        }, targetWait - elapsed);
        return;
      }

      this.executeSpin();
    },

    executeSpin: function() {
      lastSpinTime = Date.now();
      SoundEngine.init();

      const stopBtns = [
        document.getElementById('stopBtn0'),
        document.getElementById('stopBtn1'),
        document.getElementById('stopBtn2')
      ];

      if (isBonusMode) {
        betAmount = 1; internalCredits -= 1;
        setLineBadgesLit(true); // ボーナス中は「②」ランプのみ点灯
        if (window.DATA_COUNTER) window.DATA_COUNTER.onGameStart(1);
      } else if (!isReplay) {
        if (internalCredits < 3) internalCredits = 50; 
        internalCredits -= 3; betAmount = 3;
        setLineBadgesLit(true); // 通常時は①②③全点灯
        if (window.DATA_COUNTER) window.DATA_COUNTER.onGameStart(3);
      } else {
        betAmount = 3; isReplay = false;
        setLineBadgesLit(true);
        if (window.DATA_COUNTER) window.DATA_COUNTER.onGameStart(0);
      }

      isSpinning = true;
      updateDisplays(0);
      SoundEngine.play('lever');

      // 確率判定
      if (!isBonusMode && !bonusFlag) {
        const prob = PROBABILITY_TABLE[currentSetting];
        const rand = Math.random();
        if (rand < prob.big) bonusFlag = 'BIG';
        else if (rand < (prob.big + prob.reg)) bonusFlag = 'REG';

        if (bonusFlag) {
          const pekaRand = Math.random();
          if (pekaRand < 0.25) pekaTiming = 'LEVER';
          else if (pekaRand < 0.35) pekaTiming = 'STOP1';
          else if (pekaRand < 0.50) pekaTiming = 'STOP3_DOWN';
          else pekaTiming = 'STOP3_UP';
        }
      }

      if (!isBonusMode && bonusFlag && pekaTiming === 'LEVER') triggerPeka();

      // 回転速度の決定（ペカリ時は超低速スロー旋回で目押しイージー化）
      const spinSpeed = (isPeka || bonusFlag) ? REEL_SPEED_SLOW : REEL_SPEED_NORMAL;

      reels.forEach((reel, i) => {
        reel.isSpinning = true;
        reel.isStopping = false;
        reel.speed = spinSpeed; 
        this.renderReelCanvas(reel, true); 
        this.spinReel(reel);
        if (stopBtns[i]) {
          stopBtns[i].disabled = false;
          stopBtns[i].classList.add('spinning');
        }
      });

      // 回転開始とともにラインランプ消灯
      setLineBadgesLit(false);
      updateDisplays();

      if (isAutoMode) {
        this.scheduleAutoStop();
      }
    },

    stopReelIndex: function(index) {
      const reel = reels[index];
      const stopBtns = [
        document.getElementById('stopBtn0'),
        document.getElementById('stopBtn1'),
        document.getElementById('stopBtn2')
      ];

      if (!reel || !reel.isSpinning || reel.isStopping) return;
      if (stopBtns[index]) {
        stopBtns[index].disabled = true;
        stopBtns[index].classList.remove('spinning');
      }
      SoundEngine.play('stop');

      if (!isBonusMode && index === 0 && bonusFlag && pekaTiming === 'STOP1') triggerPeka();
      if (!isBonusMode && index === 2 && bonusFlag && pekaTiming === 'STOP3_DOWN') triggerPeka();

      const maxPos = reel.strip.length * SYMBOL_HEIGHT;
      let baseIdx = Math.floor(reel.pos / SYMBOL_HEIGHT) % reel.strip.length;
      if (baseIdx < 0) baseIdx += reel.strip.length;
      let targetIdx = baseIdx;

      if (isBonusMode) {
        targetIdx = baseIdx;
      } else if (bonusFlag) {
        // 【超アシスト目押し】滑り探索範囲を枠上〜枠下まで大幅拡大（大体狙えばスッと揃う）
        const targetSym = bonusFlag === 'BIG' ? '7' : (index === 2 ? 'BAR' : '7');
        let found = false;
        for (let slip = 0; slip <= 8; slip++) { // 超アシスト（8コマ滑りまで対応）
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

      if (index === 2 && !isBonusMode && bonusFlag && pekaTiming === 'STOP3_UP') {
        triggerPeka();
      }
    },

    // 全画面どこでもタップ時順次進行ロジック
    handleGlobalTap: function() {
      if (!this.isInitialized) return;

      // 回転していない状態 ➔ スタートレバーON
      if (!isSpinning) {
        this.startSpin();
        return;
      }

      // 回転中 ➔ 左・中・右の順に止める
      if (reels[0] && reels[0].isSpinning && !reels[0].isStopping) {
        this.stopReelIndex(0);
      } else if (reels[1] && reels[1].isSpinning && !reels[1].isStopping) {
        this.stopReelIndex(1);
      } else if (reels[2] && reels[2].isSpinning && !reels[2].isStopping) {
        this.stopReelIndex(2);
      }
    },

    bindEvents: function() {
      const startBtn = document.getElementById('startBtn');
      const stopBtns = [
        document.getElementById('stopBtn0'),
        document.getElementById('stopBtn1'),
        document.getElementById('stopBtn2')
      ];
      const autoToggleBtn = document.getElementById('autoToggleBtn');

      const attachFastTouch = (elem, handlerOnDown) => {
        if (!elem) return;
        let handled = false;

        const downTrigger = (e) => {
          if (e.type === 'touchstart' || e.type === 'pointerdown') handled = true;
          else if (e.type === 'click' && handled) { handled = false; return; }
          if (handlerOnDown) handlerOnDown(e);
        };

        elem.addEventListener('touchstart', downTrigger, { passive: false });
        elem.addEventListener('pointerdown', downTrigger);
        elem.addEventListener('click', downTrigger);
      };

      // スタートレバー直タップ
      if (startBtn) {
        attachFastTouch(startBtn, (e) => {
          if (e.cancelable) e.preventDefault();
          startBtn.classList.add('hit');
          setTimeout(() => startBtn.classList.remove('hit'), 150);
          this.startSpin();
        });
      }

      // ストップボタン直タップ
      stopBtns.forEach((btn, index) => {
        if (!btn) return;
        attachFastTouch(btn, (e) => {
          if (e.cancelable) e.preventDefault();
          this.stopReelIndex(index);
        });
      });

      // AUTO/MANUAL切替ボタン
      if (autoToggleBtn) {
        autoToggleBtn.onclick = () => {
          isAutoMode = !isAutoMode;
          autoToggleBtn.textContent = isAutoMode ? '🤖 AUTO: ON' : '👤 MODE: MANUAL';
          autoToggleBtn.classList.toggle('active', isAutoMode);

          if (isAutoMode && !isSpinning) {
            this.startSpin();
          }
        };
      }
    },

    scheduleAutoStop: function() {
      if (!isAutoMode) return;
      clearTimeout(autoTimer);

      autoTimer = setTimeout(() => {
        if (reels[0].isSpinning) this.stopReelIndex(0);
        autoTimer = setTimeout(() => {
          if (reels[1].isSpinning) this.stopReelIndex(1);
          autoTimer = setTimeout(() => {
            if (reels[2].isSpinning) this.stopReelIndex(2);
          }, 200);
        }, 200);
      }, 220);
    },

    // 標準スロット流下
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

    onAllStopped: function() {
      isSpinning = false; betAmount = 0;
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

      let payout = 0;

      // ボーナス消化中
      if (isBonusMode) {
        payout = 14;
        bonusAcquired += 13;
        internalCredits += payout;
        if (window.DATA_COUNTER) window.DATA_COUNTER.onPayout(payout);
        SoundEngine.play('bonus_pay');

        if (bonusAcquired >= bonusTarget) {
          isBonusMode = false;
          bonusFlag = null;
        }
        updateDisplays(payout);

        if (isAutoMode) {
          setTimeout(() => { if (isAutoMode) this.startSpin(); }, 400);
        }
        return;
      }

      // 通常停止判定
      let isBigWin = false, isRegWin = false, isReplayWin = false;

      lines.forEach(line => {
        if (line.every(s => s === '7')) isBigWin = true;
        else if (line[0] === '7' && line[1] === '7' && line[2] === 'BAR') isRegWin = true;
        else if (line.every(s => s === 'RHINO')) isReplayWin = true;
        else {
          if (line.every(s => s === 'GRAPE')) payout = Math.max(payout, 8);
          else if (line[0] === 'CHERRY') payout = Math.max(payout, 2);
          else if (line.every(s => s === 'BELL')) payout = Math.max(payout, 14);
          else if (line.every(s => s === 'CLOWN')) payout = Math.max(payout, 10);
        }
      });

      if (isBigWin) {
        isBonusMode = true; bonusType = 'BIG'; bonusAcquired = 0; bonusTarget = 252;
        if (window.DATA_COUNTER) window.DATA_COUNTER.onBonusWin('BIG');
        turnOffGogoLamp(); // 【実機準拠】777が揃った瞬間にGOGO!ランプは即消灯
        SoundEngine.play('big_fanfare');
        if (autoStopOnBonus) stopAutoMode();
      } else if (isRegWin) {
        isBonusMode = true; bonusType = 'REG'; bonusAcquired = 0; bonusTarget = 96;
        if (window.DATA_COUNTER) window.DATA_COUNTER.onBonusWin('REG');
        turnOffGogoLamp(); // 【実機準拠】77BARが揃った瞬間にGOGO!ランプは即消灯
        SoundEngine.play('reg_fanfare');
        if (autoStopOnBonus) stopAutoMode();
      } else if (isReplayWin) {
        isReplay = true;
        setLineBadgesLit(true);
        SoundEngine.play('replay');
      } else if (payout > 0) {
        internalCredits += payout;
        if (window.DATA_COUNTER) window.DATA_COUNTER.onPayout(payout);
        if (payout === 8) SoundEngine.play('grape');
        else SoundEngine.play('bonus_pay');
      }

      updateDisplays(payout);

      if (isAutoMode) {
        setTimeout(() => {
          if (isAutoMode && !isSpinning) this.startSpin();
        }, isReplayWin ? 150 : 450);
      }
    }
  };
})();

