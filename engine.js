/**
 * アイムジャグラーEX スロットゲームエンジン (engine.js)
 * 7セグLED動的制御・実機文字ランプ（Replay/Start/Wait/3BET）・ライン表示・設定モーダル連動
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
  const REEL_SPEED_BASE = 33; // 1回転0.75秒

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
  let weightCut = false;       // ウェイトカット設定
  let masterVolume = 1.0;      // 全体音量 (0.0 〜 1.0)

  let credits = 50;
  let betAmount = 0;
  let isSpinning = false;
  let isAutoMode = false;
  let autoTimer = null;
  let lastSpinTime = 0;         // 前回レバーON時刻 (ウェイト制御用)
  let isWaiting = false;

  // フラグ＆ボーナス消化状態
  let bonusFlag = null;         // 内部成立中のフラグ ('BIG' | 'REG' | null)
  let isBonusMode = false;      // ボーナス消化モード
  let bonusType = null;         // 'BIG' | 'REG'
  let bonusAcquired = 0;        // 累計純増獲得枚数
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
        this.masterGain.gain.setValueAtTime(masterVolume, this.ctx.currentTime);
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
          .catch(() => { /* MP3が無い場合はWebAudio内蔵音源へ */ });
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
        osc.frequency.setValueAtTime(320, now);
        osc.frequency.exponentialRampToValueAtTime(60, now + 0.08);
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
  // 2. 本格7セグメントLED描画ロジック
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

    // 桁数分エレメントが無ければ動的生成
    let digitElems = container.querySelectorAll('.digit7seg');
    if (digitElems.length !== digits) {
      container.innerHTML = '';
      for (let i = 0; i < digits; i++) {
        const dDiv = document.createElement('div');
        dDiv.className = 'digit7seg';
        ['a','b','c','d','e','f','g'].forEach(seg => {
          const sSpan = document.createElement('span');
          sSpan.className = `seg seg-${seg}`;
          dDiv.appendChild(sSpan);
        });
        container.appendChild(dDiv);
      }
      digitElems = container.querySelectorAll('.digit7seg');
    }

    for (let i = 0; i < digits; i++) {
      const char = valStr[i] || ' ';
      const litSegs = SEGMENT_MAP[char] || [];
      const segSpans = digitElems[i].querySelectorAll('.seg');

      segSpans.forEach(span => {
        const segName = span.className.replace('seg seg-', '');
        if (litSegs.includes(segName)) {
          span.classList.add('lit');
        } else {
          span.classList.remove('lit');
        }
      });
    }
  }

  // ===================================================
  // 3. リール描画＆キャッシング
  // ===================================================
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

  // 隙間ゼロのシームレス描画
  function drawSymbol(ctx, type, y, isReelSpinning = false) {
    const cached = symbolCanvasCache[type];
    ctx.save();
    ctx.translate(0, y);

    if (isReelSpinning && type === '7') {
      ctx.fillStyle = "rgba(255, 210, 210, 0.95)";
    } else if (isReelSpinning && type === 'BAR') {
      ctx.fillStyle = "rgba(255, 255, 255, 1.0)";
    } else {
      ctx.fillStyle = "#ffffff";
    }
    ctx.fillRect(0, -0.5, CANVAS_WIDTH, SYMBOL_HEIGHT + 1.0);

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

  // 実機パネル・ランプ表示更新
  function updateDisplays(payout = 0) {
    if (credits < 3 && !isBonusMode) credits = 50;

    // 7セグLEDの更新
    update7SegDisplay('creditDisp', credits, 2);
    update7SegDisplay('countDisp', payout > 0 ? payout : 0, 2);
    update7SegDisplay('payoutDisp', payout, 2);

    // 実機文字透過パネルの更新
    const lampReplay = document.getElementById('lampReplay');
    const lampStart = document.getElementById('lampStart');
    const lampWait = document.getElementById('lampWait');
    const lampBet3 = document.getElementById('lampBet3');

    if (lampReplay) lampReplay.classList.toggle('active', isReplay);
    if (lampStart) lampStart.classList.toggle('active', !isSpinning && (betAmount === 3 || isReplay || isBonusMode));
    if (lampWait) lampWait.classList.toggle('active', isWaiting);
    if (lampBet3) lampBet3.classList.toggle('active', betAmount === 3 && !isSpinning);

    // ボーナス中ステータス
    const bStatusEl = document.getElementById('bonusStatusDisp');
    if (bStatusEl) {
      if (isBonusMode) {
        bStatusEl.textContent = `${bonusType} BONUS GAME (獲得: ${bonusAcquired}/${bonusTarget}枚)`;
        bStatusEl.style.display = 'block';
      } else {
        bStatusEl.style.display = 'none';
      }
    }
  }

  // ライン表示器（①②③）の制御 (BET時点灯 / 回転時消灯)
  function setLineBadgesLit(isLit) {
    const badges = document.querySelectorAll('.line-badge');
    badges.forEach(badge => {
      if (isLit) badge.classList.add('lit');
      else badge.classList.remove('lit');
    });
  }

  function triggerPeka() {
    if (isPeka) return;
    isPeka = true;
    const gogoBox = document.getElementById('gogoBox');
    if (gogoBox) gogoBox.classList.add('peka');
    SoundEngine.play('gako');
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

    // 設定ダイアログ用ゲッター＆セッター
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

    // レバーON
    startSpin: function() {
      if (isSpinning) return;

      // 実機ウェイト制御 (4.1秒固定)
      const now = Date.now();
      const elapsed = now - lastSpinTime;
      if (!weightCut && lastSpinTime > 0 && elapsed < 4100) {
        isWaiting = true;
        updateDisplays();
        setTimeout(() => {
          isWaiting = false;
          this.executeSpin();
        }, 4100 - elapsed);
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

      // 【実機準拠】回転開始時にライン表示①②③を消灯
      setLineBadgesLit(false);

      if (isBonusMode) {
        betAmount = 1; credits -= 1;
        if (window.DATA_COUNTER) window.DATA_COUNTER.onGameStart(1);
      } else if (!isReplay) {
        if (credits < 3) credits = 50; 
        if (betAmount < 3) { credits -= 3; betAmount = 3; }
        if (window.DATA_COUNTER) window.DATA_COUNTER.onGameStart(3);
      } else {
        betAmount = 3; isReplay = false;
        if (window.DATA_COUNTER) window.DATA_COUNTER.onGameStart(0);
      }

      isSpinning = true;
      updateDisplays(0);
      SoundEngine.play('lever');

      // 通常時フラグ抽選
      if (!isBonusMode && !bonusFlag) {
        const prob = PROBABILITY_TABLE[currentSetting];
        const rand = Math.random();
        if (rand < prob.big) bonusFlag = 'BIG';
        else if (rand < (prob.big + prob.reg)) bonusFlag = 'REG';

        if (bonusFlag) {
          const pekaRand = Math.random();
          if (pekaRand < 0.125) pekaTiming = 'LEVER';
          else if (pekaRand < 0.1875) pekaTiming = 'STOP1';
          else if (pekaRand < 0.25) pekaTiming = 'STOP3_DOWN';
          else pekaTiming = 'STOP3_UP';

          // ボーナス成立時：設定に応じてAUTO解除して手動復帰
          if (autoStopOnBonus) {
            stopAutoMode();
          }
        }
      }

      if (!isBonusMode && bonusFlag && pekaTiming === 'LEVER') triggerPeka();

      reels.forEach((reel, i) => {
        reel.isSpinning = true;
        reel.isStopping = false;
        reel.speed = REEL_SPEED_BASE; 
        this.renderReelCanvas(reel, true); 
        this.spinReel(reel);
        if (stopBtns[i]) {
          stopBtns[i].disabled = false;
          stopBtns[i].classList.add('spinning'); // ボタン点滅LED発光
        }
      });
      updateDisplays();

      if (isAutoMode) {
        this.scheduleAutoStop();
      }
    },

    // ストップボタン押下
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
        const targetSym = bonusFlag === 'BIG' ? '7' : (index === 2 ? 'BAR' : '7');
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

      if (index === 2 && !isBonusMode && bonusFlag && pekaTiming === 'STOP3_UP') {
        triggerPeka();
      }
    },

    bindEvents: function() {
      const betBtn = document.getElementById('betBtn');
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

      // 3BETボタン (【実機準拠】BET完了時にライン表示①②③を点灯)
      attachFastTouch(betBtn, (e) => {
        if (e.cancelable) e.preventDefault();
        SoundEngine.init();
        if (isSpinning || betAmount === 3 || isBonusMode) return;
        if (credits < 3) credits = 50; 
        credits -= 3; betAmount = 3; SoundEngine.play('bet');
        setLineBadgesLit(true);
        updateDisplays();
      });

      // スタートレバー
      attachFastTouch(startBtn, (e) => {
        if (e.cancelable) e.preventDefault();
        this.startSpin();
      });

      // ストップボタン (1, 2, 3)
      stopBtns.forEach((btn, index) => {
        if (!btn) return;
        attachFastTouch(btn, (e) => {
          if (e.cancelable) e.preventDefault();
          this.stopReelIndex(index);
        });
      });

      // AUTO切替ボタン
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
      const gogoBox = document.getElementById('gogoBox');
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

      // ボーナス消化時
      if (isBonusMode) {
        payout = 14;
        bonusAcquired += 13;
        credits += payout;
        if (window.DATA_COUNTER) window.DATA_COUNTER.onPayout(payout);
        SoundEngine.play('bonus_pay');

        if (bonusAcquired >= bonusTarget) {
          isBonusMode = false;
          bonusFlag = null;
          if (gogoBox) { isPeka = false; gogoBox.classList.remove('peka'); }
        }
        updateDisplays(payout);

        if (isAutoMode) {
          setTimeout(() => { if (isAutoMode) this.startSpin(); }, 400);
        }
        return;
      }

      // 通常時判定
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
        SoundEngine.play('big_fanfare');
        if (autoStopOnBonus) stopAutoMode();
      } else if (isRegWin) {
        isBonusMode = true; bonusType = 'REG'; bonusAcquired = 0; bonusTarget = 96;
        if (window.DATA_COUNTER) window.DATA_COUNTER.onBonusWin('REG');
        SoundEngine.play('reg_fanfare');
        if (autoStopOnBonus) stopAutoMode();
      } else if (isReplayWin) {
        isReplay = true;
        setLineBadgesLit(true); // リプレイ時は次ゲームライン自動点灯
        SoundEngine.play('replay');
      } else if (payout > 0) {
        credits += payout;
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

