/**
 * スロットゲームエンジン (engine.js)
 * 白枠完全撤去・コマ高46px・200msハードロック・イベント一元化・実機BETランプ演出
 */

(function() {
  // 21コマの実機リール配列定義
  const REEL_STRIPS = [
    ['BAR', 'GRAPE', 'RHINO', 'GRAPE', 'BELL', '7', 'RHINO', 'GRAPE', 'RHINO', 'GRAPE', 'BAR', 'CHERRY', 'GRAPE', 'RHINO', 'GRAPE', '7', 'CLOWN', 'GRAPE', 'RHINO', 'GRAPE', 'CHERRY'],
    ['RHINO', 'BELL', 'GRAPE', 'CHERRY', 'RHINO', '7', 'GRAPE', 'CHERRY', 'RHINO', 'BELL', 'GRAPE', 'CHERRY', 'RHINO', 'BAR', 'GRAPE', 'CHERRY', 'CLOWN', 'RHINO', '7', 'GRAPE', 'CHERRY'],
    ['GRAPE', 'CLOWN', 'BELL', 'RHINO', 'GRAPE', '7', 'BAR', 'BELL', 'RHINO', 'GRAPE', 'CLOWN', 'BELL', 'RHINO', 'GRAPE', 'CLOWN', 'BELL', 'RHINO', 'GRAPE', 'CLOWN', 'BELL', 'RHINO']
  ];

  // 【最重要】コマサイズ (横幅100px × 高さ46px) - 縦隙間を極限圧縮
  const SYMBOL_HEIGHT = 46;
  const CANVAS_WIDTH = 100;
  const REEL_SPEED_NORMAL = 22; // 通常時スピード
  const REEL_SPEED_SLOW = 8;    // スロー旋回スピード

  // SアイムジャグラーEX 実機確率テーブル (設定1〜6)
  const PROBABILITY_TABLE = {
    1: { big: 1/273.1, reg: 1/439.8 },
    2: { big: 1/269.7, reg: 1/399.6 },
    3: { big: 1/269.7, reg: 1/330.7 },
    4: { big: 1/259.0, reg: 1/315.1 },
    5: { big: 1/259.0, reg: 1/255.0 },
    6: { big: 1/255.0, reg: 1/255.0 }
  };

  // 小役確率 (設定6基準の解析値)
  const PROB_REPLAY = 1 / 7.3;
  const PROB_GRAPE  = 1 / 5.9;
  const PROB_CHERRY = 1 / 33.0;
  const PROB_BELL   = 1 / 1092.2;
  const PROB_CLOWN  = 1 / 1092.2;

  // ゲームステート
  const STATE_IDLE = 0;
  const STATE_SPINNING = 1;
  let gameState = STATE_IDLE;
  let activeReelsCount = 0;
  let spinStartTime = 0; // 【最重要】ハードロック用タイマー

  // ゲーム内部状態
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

  // ボーナス状態
  let currentFlag = null;       // 当該ゲームの成立役フラグ
  let bonusFlag = null;         // 成立中ボーナスフラグ
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
  // 1. 高度リアル音響エンジン
  // ===================================================
  const SoundEngine = {
    ctx: null, masterGain: null, audioBuffers: {},
    init: function() {
      try {
        if (!this.ctx) {
          this.ctx = new (window.AudioContext || window.webkitAudioContext)();
          this.masterGain = this.ctx.createGain();
          this.masterGain.gain.setValueAtTime(soundOn ? masterVolume : 0, this.ctx.currentTime);
          this.masterGain.connect(this.ctx.destination);
        }
        if (this.ctx.state === 'suspended') this.ctx.resume();
        this.loadExternalSounds();
      } catch (e) {}
    },
    setVolume: function(vol) {
      masterVolume = vol;
      if (this.masterGain && this.ctx) {
        this.masterGain.gain.setValueAtTime(soundOn ? masterVolume : 0, this.ctx.currentTime);
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
        }
      } catch(e) {}
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
  // 3. コマ高46pxフィッティング描画 (白枠・装飾の完全撤去)
  // ===================================================
  function decodeRLEToCanvasPrecisionCrop(symData) {
    const rawCvs = document.createElement('canvas');
    rawCvs.width = 128; rawCvs.height = 128;
    const rawCtx = rawCvs.getContext('2d');
    // 背景塗りつぶしはしない (透過)
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
      
      // 画像の「白」部分をアルファ0（完全透過）にして背景を抜く
      const isWhite = (hex.toLowerCase() === '#ffffff' || hex.toLowerCase() === '#fff');
      
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

    // 【最重要】白背景・境界線・ドロップシャドウ等の装飾処理を1行残らず全削除。純粋な透過描画のみ。

    // コマ高46pxに対して、7/BARは特大、小役は適正サイズに
    let maxH = (type === '7' || type === 'BAR') ? SYMBOL_HEIGHT * 0.98 : SYMBOL_HEIGHT * 0.86;
    let maxW = (type === '7' || type === 'BAR') ? CANVAS_WIDTH * 0.92 : CANVAS_WIDTH * 0.80;

    const scale = Math.min(maxW / cached.crop.w, maxH / cached.crop.h);
    let drawW = cached.crop.w * scale;
    let drawH = cached.crop.h * scale;

    const drawX = Math.round((CANVAS_WIDTH - drawW) / 2);
    const drawY = Math.round((SYMBOL_HEIGHT - drawH) / 2);

    ctx.imageSmoothingEnabled = !isReelSpinning; // 回転中はアンチエイリアスOFF
    ctx.drawImage(cached.canvas, cached.crop.x, cached.crop.y, cached.crop.w, cached.crop.h, drawX, drawY, drawW, drawH);
    
    ctx.restore();
  }

  // ===================================================
  // 4. UI ＆ ランプ更新 (実機準拠ロジック)
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
    
    // 【重要】STARTランプは「遊技待機中（STATE_IDLE）かつBET可能状態」の時に確実に点灯させる
    const canPlay = isReplay || (isBonusMode ? internalCredits >= 1 : internalCredits >= 3);
    if (lampStart) {
      lampStart.classList.toggle('active', gameState === STATE_IDLE && canPlay);
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
      const pEl = document.getElementById('barTotalProb'); if(pEl) pEl.textContent = stats.totalProb;
    }
  }

  function setLineBadgesLit(isLit) {
    const b1 = document.querySelector('.line-badge.badge-1');
    const b2 = document.querySelector('.line-badge.badge-2');
    const b3 = document.querySelector('.line-badge.badge-3');
    if (!b1 || !b2 || !b3) return;

    if (isLit) {
      // 点灯させる場合：ボーナス中は中段(2)のみ、通常時は全ライン点灯
      if (isBonusMode) {
        b1.classList.remove('lit'); b2.classList.add('lit'); b3.classList.remove('lit');
      } else {
        b1.classList.add('lit'); b2.classList.add('lit'); b3.classList.add('lit');
      }
    } else {
      // レバーON等で消灯させる場合
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
  // 5. グローバルスロットエンジン
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

      // 初期起動時：ランプ点灯状態（待機状態）としてスタート
      setLineBadgesLit(true);
      updateDisplays();
      this.bindEvents();
      this.isInitialized = true;
    },

    getConfig: function() { return { setting: currentSetting, autoStopOnBonus: autoStopOnBonus, weightCut: weightCut, volume: masterVolume, soundOn: soundOn }; },
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

    drawFlag: function() {
      if (isBonusMode) return 'GRAPE';
      if (bonusFlag) return bonusFlag;

      const r = Math.random();
      const prob = PROBABILITY_TABLE[currentSetting];
      let accum = prob.big;
      if (r < accum) return 'BIG';
      accum += prob.reg;
      if (r < accum) return 'REG';
      accum += PROB_REPLAY;
      if (r < accum) return 'REPLAY';
      accum += PROB_GRAPE;
      if (r < accum) return 'GRAPE';
      accum += PROB_CHERRY;
      if (r < accum) return 'CHERRY';
      accum += PROB_BELL;
      if (r < accum) return 'BELL';
      accum += PROB_CLOWN;
      if (r < accum) return 'CLOWN';

      return null;
    },

    // レバーON処理
    startSpin: function() {
      if (gameState !== STATE_IDLE) return;

      try {
        // クレジット不足時は補充 (自動BETの前提条件)
        const canPlay = isReplay || (isBonusMode ? internalCredits >= 1 : internalCredits >= 3);
        if (!canPlay && internalCredits < 3) {
          internalCredits = 50; 
        }

        gameState = STATE_SPINNING;
        activeReelsCount = 3;
        spinStartTime = Date.now(); // 【最重要】ハードロック用のタイマー記録

        SoundEngine.init();
        triggerLeverVisual();

        // 【最重要演出】レバーONの瞬間に、BETランプとSTARTランプを「即消灯」させる
        setLineBadgesLit(false);
        updateDisplays(0);

        // Waitランプの演出 (レバーONで一瞬だけ点灯し、すぐに消える「タメ」)
        const lampWait = document.getElementById('lampWait');
        if (lampWait) {
          lampWait.classList.add('active');
          setTimeout(() => lampWait.classList.remove('active'), 250);
        }

        // BET消費と内部集計
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
        
        if (currentFlag === 'BIG' || currentFlag === 'REG') {
          if (!bonusFlag) {
            bonusFlag = currentFlag;
            const pekaRand = Math.random();
            if (pekaRand < 0.25) pekaTiming = 'LEVER';
            else if (pekaRand < 0.35) pekaTiming = 'STOP1';
            else if (pekaRand < 0.50) pekaTiming = 'STOP3_DOWN';
            else pekaTiming = 'STOP3_UP';
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
        gameState = STATE_IDLE; // セーフティネット
      }
    },

    stopReelIndex: function(index) {
      if (gameState !== STATE_SPINNING) return;
      
      // 【最重要ハードロック】レバーONから200ms以内はいかなるストップ操作も無視する（多重発火の完封）
      if (Date.now() - spinStartTime < 200) return;

      const reel = reels[index];
      if (!reel || !reel.isSpinning || reel.isStopping) return;

      try {
        reel.isStopping = true;
        activeReelsCount--;

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
        if (currentFlag === 'BIG') targetSyms = ['7'];
        else if (currentFlag === 'REG') targetSyms = index === 2 ? ['BAR'] : ['7'];
        else if (currentFlag === 'REPLAY') targetSyms = ['RHINO'];
        else if (currentFlag === 'GRAPE') targetSyms = ['GRAPE'];
        else if (currentFlag === 'CHERRY') targetSyms = ['CHERRY'];
        else if (currentFlag === 'BELL') targetSyms = ['BELL'];
        else if (currentFlag === 'CLOWN') targetSyms = ['CLOWN'];

        if (targetSyms.length > 0) {
          let found = false;
          const slipLimit = (isPeka || isBonusMode) ? 8 : 4;
          for (let slip = 0; slip <= slipLimit; slip++) {
            const checkTopIdx = (baseIdx - slip + reel.strip.length) % reel.strip.length;
            for (let offset = 0; offset <= 2; offset++) {
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

    // 【完全一元化】イベント窓口。多重登録のバブリングを排除
    handleTap: function(e) {
      if (!this.isInitialized) return;
      const now = Date.now();
      if (now - lastTapTime < 30) return; // 極小チャタリング防止
      lastTapTime = now;

      // 個別ボタンの判定 (狙い打ち対応)
      if (e && e.target) {
        const targetId = e.target.id;
        if (targetId === 'stopBtn0' || targetId === 'stopBtn1' || targetId === 'stopBtn2' || e.target.closest('.stop-btn')) {
          const btn = e.target.closest('.stop-btn');
          const idx = parseInt(btn.id.replace('stopBtn', ''), 10);
          this.stopReelIndex(idx);
          return;
        }
        if (targetId === 'startBtn' || e.target.closest('#startBtn')) {
          this.startSpin();
          return;
        }
      }

      // 上記以外の全体タップ進行
      if (gameState === STATE_IDLE) {
        this.startSpin();
      } else if (gameState === STATE_SPINNING) {
        for (let i = 0; i < 3; i++) {
          if (reels[i].isSpinning && !reels[i].isStopping) {
            this.stopReelIndex(i);
            break;
          }
        }
      }
    },

    bindEvents: function() {
      // index.htmlの不要イベントを削除し、ここで一元管理する
      // (グローバルなイベント登録用。重複を避ける)
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

      let payout = 0;

      if (isBonusMode) {
        payout = 15;
        bonusAcquired += 15;
        internalCredits += payout;
        if (window.DATA_COUNTER) window.DATA_COUNTER.onPayout(payout, 'BONUS_GRAPE');
        SoundEngine.play('bonus_pay');

        if (bonusAcquired >= bonusTarget) {
          isBonusMode = false;
          bonusFlag = null; 
          currentFlag = null;
        }
        
        // 【最重要演出】自動BET完了として即座にBETランプとSTARTランプを点灯させ待機する
        setLineBadgesLit(true);
        updateDisplays(payout);

        if (isAutoMode) setTimeout(() => { if (isAutoMode) this.startSpin(); }, 400);
        return;
      }

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
        isBonusMode = true; bonusType = 'BIG'; bonusAcquired = 0; bonusTarget = 266;
        bonusFlag = null; currentFlag = null; 
        if (window.DATA_COUNTER) window.DATA_COUNTER.onBonusWin('BIG');
        turnOffGogoLamp();
        SoundEngine.play('big_fanfare');
        if (autoStopOnBonus) stopAutoMode();
      } else if (isRegWin) {
        isBonusMode = true; bonusType = 'REG'; bonusAcquired = 0; bonusTarget = 105;
        bonusFlag = null; currentFlag = null;
        if (window.DATA_COUNTER) window.DATA_COUNTER.onBonusWin('REG');
        turnOffGogoLamp();
        SoundEngine.play('reg_fanfare');
        if (autoStopOnBonus) stopAutoMode();
      } else if (isReplayWin) {
        isReplay = true;
        SoundEngine.play('replay');
      } else if (payout > 0) {
        internalCredits += payout;
        if (window.DATA_COUNTER) {
          if (payout === 8) window.DATA_COUNTER.onPayout(payout, 'GRAPE');
          else window.DATA_COUNTER.onPayout(payout, 'OTHER');
        }
        if (payout === 8) SoundEngine.play('grape');
        else SoundEngine.play('bonus_pay');
      }

      currentFlag = null;

      // 【最重要演出】全リール停止＆払出処理が完了したら、即座に次ゲームのBET状態としてランプを点灯させる
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


