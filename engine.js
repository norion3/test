/**
 * スロットゲームエンジン (engine.js)
 * DMM完全解析確率・100G以内連チャンBGM判定(1G連/ゾロ目)・プレミア演出・クレジット＆差枚数分離連動・高速カウントアップ補充・AUTO画面タップ解除
 */

(function() {
  // 21コマの実機リール配列定義
  const REEL_STRIPS = [
    ['BAR', 'GRAPE', 'RHINO', 'GRAPE', 'BELL', '7', 'RHINO', 'GRAPE', 'RHINO', 'GRAPE', 'BAR', 'CHERRY', 'GRAPE', 'RHINO', 'GRAPE', '7', 'CLOWN', 'GRAPE', 'RHINO', 'GRAPE', 'CHERRY'],
    ['RHINO', 'BELL', 'GRAPE', 'CHERRY', 'RHINO', '7', 'GRAPE', 'CHERRY', 'RHINO', 'BELL', 'GRAPE', 'CHERRY', 'RHINO', 'BAR', 'GRAPE', 'CHERRY', 'CLOWN', 'RHINO', '7', 'GRAPE', 'CHERRY'],
    ['GRAPE', 'CLOWN', 'BELL', 'RHINO', 'GRAPE', '7', 'BAR', 'BELL', 'RHINO', 'GRAPE', 'CLOWN', 'BELL', 'RHINO', 'GRAPE', 'CLOWN', 'BELL', 'RHINO', 'GRAPE', 'CLOWN', 'BELL', 'RHINO']
  ];

  const SYMBOL_HEIGHT = 46;
  const CANVAS_WIDTH = 100;
  const REEL_SPEED_NORMAL = 22; 
  const REEL_SPEED_SLOW = 8;    

  // SアイムジャグラーEX 実機確率テーブル (設定1〜6) + DMM解析
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

  let isTouchActive = false;
  let hasActionExecutedInCurrentTouch = false;

  let currentSetting = 6;
  let autoStopOnBonus = true;
  let weightCut = true;
  let soundOn = false;

  // メダル制御（クレジットと下皿/持ちメダルの完全分離）
  let credits = 50;            // 画面表示クレジット (0〜50)
  let betAmount = 0;           // 現在進行ゲームのBET数
  let isAutoMode = false;
  let autoTimer = null;

  let currentFlag = null;       
  let bonusFlag = null;         
  let isBonusMode = false;
  let bonusType = null;
  let bonusAcquired = 0;
  let bonusTarget = 0; 
  let gamesSinceLastBonus = 999; // 前回のボーナス終了後からの通常回転数カウント

  let isPeka = false;
  let pekaTiming = null;
  let premiumMode = null;      // 'FREEZE' | 'SILENT' | 'RAINBOW' | 'FLASH' | null
  let isReplay = false;
  let reels = [];

  // ===================================================
  // 1. UI ＆ ランプ更新
  // ===================================================
  function updateDisplays(payout = 0) {
    if (window.REEL_RENDERER) {
      window.REEL_RENDERER.update7SegDisplay('creditDisp', credits, 2);
      window.REEL_RENDERER.update7SegDisplay('countDisp', isBonusMode ? bonusAcquired : 0, 3);
      window.REEL_RENDERER.update7SegDisplay('payoutDisp', payout, 2);
    }

    const lampReplay = document.getElementById('lampReplay');
    const lampStart = document.getElementById('lampStart');

    if (lampReplay) lampReplay.classList.toggle('active', isReplay);
    
    // プレイ可能判定 (リプレイ中、またはクレジット/手持ちメダルが足りているか)
    const neededBet = isBonusMode ? 1 : 3;
    const canPlay = isReplay || (credits >= neededBet);
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
      const pEl = document.getElementById('barTotalProb'); if(pEl) pEl.textContent = stats.totalProb;
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
    if (gogoBox) {
      gogoBox.classList.add('peka');
      if (premiumMode === 'RAINBOW') gogoBox.classList.add('rainbow');
      else if (premiumMode === 'FLASH') gogoBox.classList.add('flash');
    }

    if (premiumMode === 'FREEZE') {
      if (window.SLOT_SOUND) window.SLOT_SOUND.play('premium_freeze');
    } else {
      if (window.SLOT_SOUND) window.SLOT_SOUND.play('gako');
    }
    
    // 設定モーダルの「ボーナス時にAUTO解除」がONの時のみAUTO解除を実行
    if (isAutoMode && autoStopOnBonus) {
      stopAutoMode();
    }
  }

  function turnOffGogoLamp() {
    isPeka = false;
    premiumMode = null;
    const gogoBox = document.getElementById('gogoBox');
    if (gogoBox) {
      gogoBox.classList.remove('peka', 'rainbow', 'flash');
    }
  }

  function stopAutoMode() {
    isAutoMode = false;
    if (autoTimer) {
      clearTimeout(autoTimer);
      autoTimer = null;
    }
    const btn = document.getElementById('autoToggleBtn');
    if (btn) { btn.textContent = '👤 MANUAL'; btn.classList.remove('active'); }
  }

  function triggerLeverVisual() {
    const startBtn = document.getElementById('startBtn');
    if (startBtn) {
      startBtn.classList.add('hit');
      setTimeout(() => startBtn.classList.remove('hit'), 150);
    }
  }

  // ===================================================
  // 2. グローバルスロットエンジン (JUGGLER_ENGINE)
  // ===================================================
  window.JUGGLER_ENGINE = {
    isInitialized: false,
    
    init: function() {
      if (this.isInitialized) return;
      if (window.REEL_RENDERER) window.REEL_RENDERER.initSymbolCache();

      reels = REEL_STRIPS.map((strip, idx) => {
        const canvas = document.getElementById(`reelCanvas${idx}`);
        if (!canvas) return null;
        canvas.width = CANVAS_WIDTH; canvas.height = SYMBOL_HEIGHT * strip.length * 3;
        const ctx = canvas.getContext('2d');
        
        const reelObj = {
          id: idx, strip: strip, canvas: canvas, ctx: ctx,
          currentIndex: 0, isSpinning: false, isStopping: false,
          speed: 0, pos: 0, targetPos: 0, animId: null
        };

        const currentIdx = Math.floor(Math.random() * strip.length);
        const initialPos = currentIdx * SYMBOL_HEIGHT;
        reelObj.currentIndex = currentIdx;
        reelObj.pos = initialPos;
        canvas.style.transform = `translateY(-${initialPos}px)`;

        if (window.REEL_RENDERER) window.REEL_RENDERER.renderReelCanvas(reelObj, false);

        return reelObj;
      }).filter(Boolean);

      setLineBadgesLit(true);
      updateDisplays();
      this.bindEvents();
      this.isInitialized = true;
    },

    resetGame: function() {
      gameState = STATE_IDLE;
      activeReelsCount = 0;
      isTouchActive = false;
      hasActionExecutedInCurrentTouch = false;
      
      credits = 50;
      betAmount = 0;
      isAutoMode = false;
      if (autoTimer) {
        clearTimeout(autoTimer);
        autoTimer = null;
      }
      
      currentFlag = null;
      bonusFlag = null;
      isBonusMode = false;
      bonusType = null;
      bonusAcquired = 0;
      gamesSinceLastBonus = 999;
      isPeka = false;
      pekaTiming = null;
      premiumMode = null;
      isReplay = false;
      
      if (window.SLOT_SOUND) window.SLOT_SOUND.stopBGM();
      turnOffGogoLamp();
      
      reels.forEach(reel => {
        reel.isSpinning = false;
        reel.isStopping = false;
        if (reel.animId) {
          cancelAnimationFrame(reel.animId);
          reel.animId = null;
        }
        const currentIdx = Math.floor(Math.random() * reel.strip.length);
        reel.currentIndex = currentIdx;
        reel.pos = currentIdx * SYMBOL_HEIGHT;
        reel.canvas.style.transform = `translateY(-${reel.pos}px)`;
        if (window.REEL_RENDERER) window.REEL_RENDERER.renderReelCanvas(reel, false);
        
        const btn = document.getElementById(`stopBtn${reel.id}`);
        if(btn) { btn.disabled = true; btn.classList.remove('spinning'); }
      });
      
      const autoToggleBtn = document.getElementById('autoToggleBtn');
      if(autoToggleBtn) {
        autoToggleBtn.textContent = '👤 MANUAL';
        autoToggleBtn.classList.remove('active');
      }
      
      setLineBadgesLit(true);
      updateDisplays(0);
    },

    getConfig: function() { 
      return { setting: currentSetting, autoStopOnBonus: autoStopOnBonus, weightCut: weightCut, soundOn: soundOn }; 
    },
    
    setConfig: function(config) {
      if (config.setting !== undefined) currentSetting = config.setting;
      if (config.autoStopOnBonus !== undefined) autoStopOnBonus = config.autoStopOnBonus;
      if (config.weightCut !== undefined) weightCut = config.weightCut;
      if (config.soundOn !== undefined) soundOn = config.soundOn;

      if (window.SLOT_SOUND) {
        window.SLOT_SOUND.setVolumeAndState(soundOn);
      }
    },

    // 毎ゲームの抽選 (成立後も通常抽選を正常に行い、小役揃いを解禁)
    drawFlag: function() {
      if (isBonusMode) return 'GRAPE'; 

      const r = Math.random();
      const prob = PROBABILITY_TABLE[currentSetting];
      let accum = 0;
      
      // 1. 小役抽選（成立後でも小役当選を最優先）
      accum += PROB_REPLAY; if (r < accum) return 'REPLAY';
      accum += prob.grape; if (r < accum) return 'GRAPE';
      
      const sCherryProb = prob.cherry - prob.cBIG - prob.cREG;
      accum += sCherryProb; if (r < accum) return 'CHERRY';
      
      accum += PROB_BELL; if (r < accum) return 'BELL';
      accum += PROB_CLOWN; if (r < accum) return 'CLOWN';

      // 2. ボーナス重複／単独抽選
      accum += prob.sBIG; if (r < accum) return 'BIG';
      accum += prob.sREG; if (r < accum) return 'REG';
      accum += prob.cBIG; if (r < accum) return 'CHERRY_BIG';
      accum += prob.cREG; if (r < accum) return 'CHERRY_REG';

      return null;
    },

    startSpin: function() {
      if (gameState !== STATE_IDLE) return;

      try {
        const neededBet = isBonusMode ? 1 : 3;
        let autoRefillHappened = false;

        // クレジット不足時の自動補給判定
        if (!isReplay && credits < neededBet) {
          autoRefillHappened = true;
        }

        gameState = STATE_SPINNING;
        activeReelsCount = 3;
        hasActionExecutedInCurrentTouch = true;

        if (window.SLOT_SOUND) window.SLOT_SOUND.preload();
        triggerLeverVisual();

        setLineBadgesLit(false);

        // リール回転＆抽選発火シーケンス
        const executeSpinSequence = () => {
          // BET消費によるクレジット即時減算
          if (isBonusMode) {
            betAmount = 1;
            credits -= 1;
            if (window.DATA_COUNTER) window.DATA_COUNTER.onGameStart(1, true);
          } else if (!isReplay) {
            betAmount = 3;
            credits -= 3;
            gamesSinceLastBonus++; // 【100G以内連チャン判定】通常ゲーム数カウントアップ
            if (window.DATA_COUNTER) window.DATA_COUNTER.onGameStart(3, false);
          } else {
            betAmount = 3;
            isReplay = false; // リプレイ時はBET減算なし
            if (window.DATA_COUNTER) window.DATA_COUNTER.onGameStart(0, false);
          }

          updateDisplays(0);

          // ウェイトカット時であっても一瞬Waitランプを点灯させる演出
          const lampWait = document.getElementById('lampWait');
          if (lampWait) {
            lampWait.classList.add('active');
            setTimeout(() => lampWait.classList.remove('active'), 250);
          }

          currentFlag = this.drawFlag();
          
          // ボーナス当選判定 ＆ プレミア演出振分
          if (currentFlag === 'BIG' || currentFlag === 'REG' || currentFlag === 'CHERRY_BIG' || currentFlag === 'CHERRY_REG') {
            if (!bonusFlag) {
              bonusFlag = currentFlag;
              premiumMode = null;

              // BIG当選時限定のプレミア演出振分 (確率約25%)
              if (bonusFlag === 'BIG' || bonusFlag === 'CHERRY_BIG') {
                const premRand = Math.random();
                if (premRand < 0.10) {
                  premiumMode = 'FREEZE';  // 10%: 一瞬フリーズ＋爆音ガコッ！
                  pekaTiming = 'LEVER';
                } else if (premRand < 0.15) {
                  premiumMode = 'SILENT';  // 5%: レバーON無音スタート
                  pekaTiming = 'LEVER';
                } else if (premRand < 0.20) {
                  premiumMode = 'RAINBOW'; // 5%: プレミアムレインボー発光
                  pekaTiming = 'LEVER';
                } else if (premRand < 0.25) {
                  premiumMode = 'FLASH';   // 5%: プレミアム高速点滅
                  pekaTiming = 'STOP3_UP';
                }
              }

              // 通常ペカタイミングの決定 (プレミア未当選時)
              if (!premiumMode) {
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
          }

          // 音響の再生 (無音スタート時はレバー音を消音)
          if (premiumMode !== 'SILENT') {
            if (window.SLOT_SOUND) window.SLOT_SOUND.play('lever');
          }

          // プレミアフリーズ処理 (0.6秒フリーズ後にリール始動)
          const startReelAnimation = () => {
            if (!isBonusMode && bonusFlag && pekaTiming === 'LEVER') triggerPeka();

            const spinSpeed = (isPeka && !isBonusMode) ? REEL_SPEED_SLOW : REEL_SPEED_NORMAL;

            reels.forEach((reel, i) => {
              reel.isSpinning = true;
              reel.isStopping = false;
              reel.speed = spinSpeed; 
              if (window.REEL_RENDERER) window.REEL_RENDERER.renderReelCanvas(reel, true); 
              this.spinReel(reel);
              const btn = document.getElementById(`stopBtn${i}`);
              if (btn) { btn.disabled = false; btn.classList.add('spinning'); }
            });

            if (isAutoMode) this.scheduleAutoStop();
          };

          if (premiumMode === 'FREEZE') {
            // 一瞬フリーズ (600ms待機後にペカリ＆リール始動)
            setTimeout(startReelAnimation, 600);
          } else {
            startReelAnimation();
          }
        };

        // 自動補給発生時は約350msかけてトトトトッと50までカウントアップ増算演出（コイン投入感の体感）
        if (autoRefillHappened) {
          const startCredits = credits;
          const targetCredits = 50;
          const steps = 5;
          const stepTime = 60; // 60ms * 5 = 300ms
          let currentStep = 0;

          const refillInterval = setInterval(() => {
            currentStep++;
            credits = Math.min(targetCredits, startCredits + Math.round((targetCredits - startCredits) * (currentStep / steps)));
            updateDisplays(0);
            if (window.SLOT_SOUND) window.SLOT_SOUND.play('bet');

            if (currentStep >= steps) {
              clearInterval(refillInterval);
              credits = targetCredits;
              updateDisplays(0);
              setTimeout(executeSpinSequence, 100);
            }
          }, stepTime);
        } else {
          executeSpinSequence();
        }

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
        // AUTOモード実行中に手動タップが入った場合、進行中のAUTOタイマーを即座に安全破棄
        if (!isAutoCall && autoTimer) {
          clearTimeout(autoTimer);
          autoTimer = null;
        }

        reel.isStopping = true;
        activeReelsCount--;
        if (!isAutoCall) hasActionExecutedInCurrentTouch = true;

        const btn = document.getElementById(`stopBtn${index}`);
        if (btn) { btn.disabled = true; btn.classList.remove('spinning'); }
        if (window.SLOT_SOUND) window.SLOT_SOUND.play('stop');

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
          // 狙う図柄の判定
          if (currentFlag === 'BIG') targetSyms = ['7'];
          else if (currentFlag === 'REG') targetSyms = index === 2 ? ['BAR'] : ['7'];
          else if (currentFlag === 'CHERRY_BIG' || currentFlag === 'CHERRY_REG' || currentFlag === 'CHERRY') targetSyms = ['CHERRY'];
          else if (currentFlag === 'REPLAY') targetSyms = ['RHINO'];
          else if (currentFlag === 'GRAPE') targetSyms = ['GRAPE'];
          else if (currentFlag === 'BELL') targetSyms = ['BELL'];
          else if (currentFlag === 'CLOWN') targetSyms = ['CLOWN'];
          else if (!currentFlag && bonusFlag) {
            // ボーナス成立後のハズレゲームではボーナス図柄を狙わせる
            if (bonusFlag === 'BIG' || bonusFlag === 'CHERRY_BIG') targetSyms = ['7'];
            else if (bonusFlag === 'REG' || bonusFlag === 'CHERRY_REG') targetSyms = index === 2 ? ['BAR'] : ['7'];
          }
        }

        // 成立ゲーム(当選G)・成立後・ボーナス消化中での21コマ超アシスト適用
        let slipLimit = 4;
        const isBonusFlagCurrent = (currentFlag === 'BIG' || currentFlag === 'REG' || currentFlag === 'CHERRY_BIG' || currentFlag === 'CHERRY_REG');
        if (isBonusMode || bonusFlag || isBonusFlagCurrent) {
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

        // 第3ボタン離し時のペカリ判定
        if (index === 2 && !isBonusMode && bonusFlag && pekaTiming === 'STOP3_UP') triggerPeka();
      } catch (e) {}
    },

    handleTap: function() {
      if (!this.isInitialized) return;

      // AUTOモード稼働中に画面タップがあった場合、即座にMANUAL（手動）モードへ安全復帰
      if (isAutoMode) {
        stopAutoMode();
      }

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
      const startTouchSession = () => {
        isTouchActive = true;
        if (window.SLOT_SOUND) window.SLOT_SOUND.preload();
      };
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
          autoToggleBtn.textContent = isAutoMode ? '🤖 AUTO' : '👤 MANUAL';
          autoToggleBtn.classList.toggle('active', isAutoMode);
          if (isAutoMode && gameState === STATE_IDLE) this.startSpin();
        };
        autoToggleBtn.addEventListener('touchstart', toggleAuto, { passive: false });
        autoToggleBtn.addEventListener('click', toggleAuto);
      }
    },

    scheduleAutoStop: function() {
      if (!isAutoMode) return;
      if (autoTimer) clearTimeout(autoTimer);
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
          // 目揃いズレ完全防ぎ：減速完了領域に達した時点でアニメーションIdをクリアし理論位置に確定固定
          if (dist <= reel.speed || dist < 2) {
            reel.pos = reel.targetPos; 
            reel.isSpinning = false; 
            reel.isStopping = false;
            if (reel.animId) {
              cancelAnimationFrame(reel.animId);
              reel.animId = null;
            }
            reel.canvas.style.transform = `translateY(-${reel.pos}px)`;
            if (window.REEL_RENDERER) window.REEL_RENDERER.renderReelCanvas(reel, false);
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

      // ベル・ピエロの全マス一致判定（every）厳格化
      activeLines.forEach(line => {
        if (line.every(s => s === '7')) isBigWin = true;
        else if (line[0] === '7' && line[1] === '7' && line[2] === 'BAR') isRegWin = true;
        else if (line.every(s => s === 'RHINO')) isReplayWin = true;
        else if (line.every(s => s === 'GRAPE')) grapeWin = true;
        else if (line[0] === 'CHERRY') cherryWin = true;
        else if (line.every(s => s === 'BELL')) bellWin = true; 
        else if (line.every(s => s === 'CLOWN')) clownWin = true;
      });

      if (grapeWin) { 
        payout = isBonusMode ? (bonusType === 'BIG' ? 15 : 13) : 8; 
        playSoundType = 'grape'; 
      }
      if (cherryWin && !isBonusMode) { payout = Math.max(payout, 2); playSoundType = 'cherry'; }
      if (bellWin && !isBonusMode) { payout = Math.max(payout, 14); playSoundType = 'bell_clown'; }
      if (clownWin && !isBonusMode) { payout = Math.max(payout, 10); playSoundType = 'bell_clown'; }

      // 払い出し（PAYOUT）の処理。クレジット（最大50）へ優先加算
      if (payout > 0) {
        credits += payout;
        if (credits > 50) {
          credits = 50; // 50を超えた分は持ちメダル（差枚数）にプール
        }

        if (window.DATA_COUNTER) {
          window.DATA_COUNTER.onPayout(payout, grapeWin ? (isBonusMode ? 'BONUS_GRAPE' : 'GRAPE') : 'OTHER');
        }
        if (window.SLOT_SOUND) window.SLOT_SOUND.play(playSoundType);
      }

      if (isBonusMode) {
        if (payout > 0) bonusAcquired += payout;
        
        if (bonusAcquired >= bonusTarget) {
          isBonusMode = false;
          bonusFlag = null; 
          currentFlag = null;
          gamesSinceLastBonus = 0; // 【重要】ボーナス終了時にゲーム数カウントを 0 にリセット
          if (window.DATA_COUNTER && typeof window.DATA_COUNTER.onBonusEnd === 'function') {
            window.DATA_COUNTER.onBonusEnd(); // データカウンターのゲーム数を0Gへリセット
          }
          if (window.SLOT_SOUND) window.SLOT_SOUND.stopBGM();
        }
        setLineBadgesLit(true);
        updateDisplays(payout);
        if (isAutoMode) setTimeout(() => { if (isAutoMode) this.startSpin(); }, 400);
        return;
      }

      const justWonBonus = (isBigWin || isRegWin);

      if (isBigWin) {
        isBonusMode = true; bonusType = 'BIG'; bonusAcquired = 0; bonusTarget = 266;
        
        // 【要件実現】100G以内連チャン判定（1G連 ＆ 11G〜99Gのゾロ目G数）
        const is1GWin = (gamesSinceLastBonus === 1);
        const isZoromeWin = (gamesSinceLastBonus <= 100 && gamesSinceLastBonus > 0 && gamesSinceLastBonus % 11 === 0);
        const isSpecialBgm = is1GWin || isZoromeWin;

        bonusFlag = null; currentFlag = null; 
        if (window.DATA_COUNTER) window.DATA_COUNTER.onBonusWin('BIG');
        turnOffGogoLamp();
        
        if (window.SLOT_SOUND) {
          window.SLOT_SOUND.play('big_fanfare');
          const bgmType = isSpecialBgm ? 'BIG_SPECIAL' : 'BIG';
          setTimeout(() => { window.SLOT_SOUND.playBGM(bgmType); }, 1500);
        }
        if (autoStopOnBonus) stopAutoMode();
      } else if (isRegWin) {
        // REG中の目標獲得枚数を 91枚 に補正 (13枚×7回＝91枚)
        isBonusMode = true; bonusType = 'REG'; bonusAcquired = 0; bonusTarget = 91;
        bonusFlag = null; currentFlag = null;
        if (window.DATA_COUNTER) window.DATA_COUNTER.onBonusWin('REG');
        turnOffGogoLamp();
        if (window.SLOT_SOUND) {
          window.SLOT_SOUND.play('reg_fanfare');
          setTimeout(() => { window.SLOT_SOUND.playBGM('REG'); }, 1500);
        }
        if (autoStopOnBonus) stopAutoMode();
      } else if (isReplayWin) {
        isReplay = true;
        if (window.SLOT_SOUND) window.SLOT_SOUND.play('replay');
      }

      currentFlag = null;
      setLineBadgesLit(true);
      updateDisplays(payout);

      if (isAutoMode) {
        // AUTOモード継続中 ＋ ボーナス揃い時限定で「2秒間の鑑賞ウェイト（2000ms）」を挟む
        let nextDelay = isReplayWin ? 150 : 450;
        if (justWonBonus && !autoStopOnBonus) {
          nextDelay = 2000; // ボーナス図柄鑑賞用2秒ウェイト
        }

        setTimeout(() => {
          if (isAutoMode && gameState === STATE_IDLE) this.startSpin();
        }, nextDelay);
      }
    }
  };
})();

