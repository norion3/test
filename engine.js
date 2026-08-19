/**
 * スロットゲームエンジン (engine.js)
 * ネオアイムジャグラーEX配列完全適合・ペカ後1枚掛け中段777/77BAR一発揃い(neededSlip直結型)完全完治・AUTO動作中手動ストップボタン割り込み時安全解除補正・AUTOストップタイミング自然テンポ最適化(前リール完全停止+220ms自然ウェイト)・ボーナス揃い音響シーケンスチェーン固定(3.5秒目視確認待ち)・単独ボーナス(ペカ前)リーチ目優先形成制御・非チェリー時左リールチェリー露出回避・Wait機能(リアル4.1秒ウェイト＆自動補給テンポ補正)・フリーズ時ランプ同期・ボタン直押し変則打ち対応・完全オート目押し仕様(21コマ引込)・直揃い禁止絶対保護・REG13枚払出(純増96枚)独自計算保護・ボーナス中全小役払出統合・ハサミ打ち/逆押し対応先読みアルゴリズム・100G連BGM
 */

(function() {
  // ネオアイムジャグラーEX 正統21コマ実機リール配列定義 (画像①〜㉑と100%同一)
  const REEL_STRIPS = [
    ['BELL', '7', 'RHINO', 'GRAPE', 'RHINO', 'GRAPE', 'BAR', 'CHERRY', 'GRAPE', 'RHINO', 'GRAPE', '7', 'CLOWN', 'GRAPE', 'RHINO', 'GRAPE', 'CHERRY', 'BAR', 'GRAPE', 'RHINO', 'GRAPE'],
    ['RHINO', '7', 'GRAPE', 'CHERRY', 'RHINO', 'BELL', 'GRAPE', 'CHERRY', 'RHINO', 'BAR', 'GRAPE', 'CHERRY', 'RHINO', 'BELL', 'GRAPE', 'CHERRY', 'RHINO', 'BAR', 'GRAPE', 'CHERRY', 'CLOWN'],
    ['GRAPE', '7', 'BAR', 'BELL', 'RHINO', 'GRAPE', 'CLOWN', 'BELL', 'RHINO', 'GRAPE', 'CLOWN', 'BELL', 'RHINO', 'GRAPE', 'CLOWN', 'BELL', 'RHINO', 'GRAPE', 'CLOWN', 'BELL', 'RHINO']
  ];

  const SYMBOL_HEIGHT = 46;
  const CANVAS_WIDTH = 100;
  const REEL_SPEED_NORMAL = 22; 
  const REEL_SPEED_SLOW = 8;    

  // SアイムジャグラーEX / ネオアイムジャグラーEX 実機確率テーブル
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

  // リアル4.1秒ウェイト制御用タイムスタンプ変数
  let lastSpinTime = 0;

  let credits = 50;
  let betAmount = 0;
  let isAutoMode = false;
  let autoTimer = null;

  let currentFlag = null;       
  let bonusFlag = null;         
  let isBonusMode = false;
  let bonusType = null;
  let bonusAcquired = 0;
  let bonusTarget = 0; 
  let gamesSinceLastBonus = 999;

  let isPeka = false;
  let pekaTiming = null;
  let premiumMode = null;
  let isReplay = false;
  let reels = [];

  function updateDisplays(payout = 0) {
    if (window.REEL_RENDERER) {
      window.REEL_RENDERER.update7SegDisplay('creditDisp', credits, 2);
      window.REEL_RENDERER.update7SegDisplay('countDisp', isBonusMode ? bonusAcquired : 0, 3);
      window.REEL_RENDERER.update7SegDisplay('payoutDisp', payout, 2);
    }

    const lampReplay = document.getElementById('lampReplay');
    const lampStart = document.getElementById('lampStart');
    if (lampReplay) lampReplay.classList.toggle('active', isReplay);
    
    // 実機準拠：ボーナス消化中およびペカ後のボーナス揃いゲームは1枚掛け
    const isOneBetGame = isBonusMode || Boolean(bonusFlag);
    const neededBet = isOneBetGame ? 1 : 3;
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
      // 実機準拠：ボーナス消化中およびペカ後のボーナス揃いゲームは「中段1ライン（1枚掛け）」のみ点灯
      const isOneBetGame = isBonusMode || Boolean(bonusFlag);
      if (isOneBetGame) {
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
      const shouldPlayGako = (pekaTiming === 'LEVER') || (Math.random() < 0.25);
      if (shouldPlayGako && window.SLOT_SOUND) {
        window.SLOT_SOUND.play('gako');
      }
    }
    
    if (isAutoMode && autoStopOnBonus) stopAutoMode();
  }

  function turnOffGogoLamp() {
    isPeka = false;
    premiumMode = null;
    const gogoBox = document.getElementById('gogoBox');
    if (gogoBox) gogoBox.classList.remove('peka', 'rainbow', 'flash');
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
      lastSpinTime = 0;
      credits = 50; betAmount = 0; isAutoMode = false;
      if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
      
      currentFlag = null; bonusFlag = null; isBonusMode = false;
      bonusType = null; bonusAcquired = 0; gamesSinceLastBonus = 999;
      isPeka = false; pekaTiming = null; premiumMode = null; isReplay = false;
      
      if (window.SLOT_SOUND) window.SLOT_SOUND.stopBGM();
      turnOffGogoLamp();
      
      reels.forEach(reel => {
        reel.isSpinning = false; reel.isStopping = false;
        if (reel.animId) { cancelAnimationFrame(reel.animId); reel.animId = null; }
        const currentIdx = Math.floor(Math.random() * reel.strip.length);
        reel.currentIndex = currentIdx;
        reel.pos = currentIdx * SYMBOL_HEIGHT;
        reel.canvas.style.transform = `translateY(-${reel.pos}px)`;
        if (window.REEL_RENDERER) window.REEL_RENDERER.renderReelCanvas(reel, false);
        const btn = document.getElementById(`stopBtn${reel.id}`);
        if(btn) { btn.disabled = true; btn.classList.remove('spinning'); }
      });
      
      const autoToggleBtn = document.getElementById('autoToggleBtn');
      if(autoToggleBtn) { autoToggleBtn.textContent = '👤 MANUAL'; autoToggleBtn.classList.remove('active'); }
      setLineBadgesLit(true);
      updateDisplays(0);
    },

    getConfig: function() { return { setting: currentSetting, autoStopOnBonus: autoStopOnBonus, weightCut: weightCut, soundOn: soundOn }; },
    setConfig: function(config) {
      if (config.setting !== undefined) currentSetting = config.setting;
      if (config.autoStopOnBonus !== undefined) autoStopOnBonus = config.autoStopOnBonus;
      if (config.weightCut !== undefined) weightCut = config.weightCut;
      if (config.soundOn !== undefined) soundOn = config.soundOn;
      if (window.SLOT_SOUND) window.SLOT_SOUND.setVolumeAndState(soundOn);
    },

    drawFlag: function() {
      const r = Math.random();
      // ボーナス中のフラグ抽選（ブドウ高確率、チェリー低確率）
      if (isBonusMode) {
          if (r < 0.05) return 'CHERRY';
          return 'GRAPE';
      }

      const prob = PROBABILITY_TABLE[currentSetting];
      let accum = 0;
      
      accum += PROB_REPLAY; if (r < accum) return 'REPLAY';
      accum += prob.grape; if (r < accum) return 'GRAPE';
      
      const sCherryProb = prob.cherry - prob.cBIG - prob.cREG;
      accum += sCherryProb; if (r < accum) return 'CHERRY';
      
      accum += PROB_BELL; if (r < accum) return 'BELL';
      accum += PROB_CLOWN; if (r < accum) return 'CLOWN';

      accum += prob.sBIG; if (r < accum) return 'BIG';
      accum += prob.sREG; if (r < accum) return 'REG';
      accum += prob.cBIG; if (r < accum) return 'CHERRY_BIG';
      accum += prob.cREG; if (r < accum) return 'CHERRY_REG';

      return null;
    },

    startSpin: function() {
      if (gameState !== STATE_IDLE) return;
      try {
        // 実機準拠：ボーナス消化中およびペカ後のボーナス揃いゲームは1枚掛け（メダル1枚消費）
        const isOneBetGame = isBonusMode || Boolean(bonusFlag);
        const neededBet = isOneBetGame ? 1 : 3;
        let autoRefillHappened = false;

        if (!isReplay && credits < neededBet) autoRefillHappened = true;

        gameState = STATE_SPINNING;
        activeReelsCount = 3;
        hasActionExecutedInCurrentTouch = true;

        if (window.SLOT_SOUND) window.SLOT_SOUND.preload();
        triggerLeverVisual();

        // 自動ベット区切り演出：レバーON時に有効ラインランプを消灯（自動ベット時の1G進行の明瞭化）
        setLineBadgesLit(false);

        const executeSpinSequence = () => {
          // コイン補給完了直後に時刻を取得し、Wait二重加算を防止
          const now = Date.now();
          let waitDelay = 0;
          if (!weightCut && lastSpinTime > 0) {
            const elapsed = now - lastSpinTime;
            if (elapsed < 4100) {
              waitDelay = 4100 - elapsed;
            }
          }
          lastSpinTime = now + waitDelay; // 次回計算基準値

          if (isOneBetGame) {
            betAmount = 1; credits -= 1;
            if (window.DATA_COUNTER) window.DATA_COUNTER.onGameStart(1, isBonusMode);
          } else if (!isReplay) {
            betAmount = 3; credits -= 3;
            gamesSinceLastBonus++;
            if (window.DATA_COUNTER) window.DATA_COUNTER.onGameStart(3, false);
          } else {
            betAmount = 3; isReplay = false;
            if (window.DATA_COUNTER) window.DATA_COUNTER.onGameStart(0, false);
          }
          updateDisplays(0);

          // WAITランプ演出制御
          const lampWait = document.getElementById('lampWait');
          if (lampWait) {
            lampWait.classList.add('active');
          }

          currentFlag = this.drawFlag();
          
          if (currentFlag === 'BIG' || currentFlag === 'REG' || currentFlag === 'CHERRY_BIG' || currentFlag === 'CHERRY_REG') {
            if (!bonusFlag) {
              bonusFlag = currentFlag;
              premiumMode = null;

              if (bonusFlag === 'BIG' || bonusFlag === 'CHERRY_BIG') {
                const premRand = Math.random();
                if (premRand < 0.10) { premiumMode = 'FREEZE'; pekaTiming = 'LEVER'; }
                else if (premRand < 0.15) { premiumMode = 'SILENT'; pekaTiming = 'LEVER'; }
                else if (premRand < 0.20) { premiumMode = 'RAINBOW'; pekaTiming = 'LEVER'; }
                else if (premRand < 0.25) { premiumMode = 'FLASH'; pekaTiming = 'STOP3_UP'; }
              }

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

          if (premiumMode !== 'SILENT' && window.SLOT_SOUND) {
            window.SLOT_SOUND.play('lever');
          }

          const startReelAnimation = () => {
            if (!isBonusMode && bonusFlag && pekaTiming === 'LEVER') triggerPeka();
            const spinSpeed = (isPeka && !isBonusMode) ? REEL_SPEED_SLOW : REEL_SPEED_NORMAL;

            reels.forEach((reel, i) => {
              reel.isSpinning = true; reel.isStopping = false; reel.speed = spinSpeed; 
              if (window.REEL_RENDERER) window.REEL_RENDERER.renderReelCanvas(reel, true); 
              this.spinReel(reel);
              const btn = document.getElementById(`stopBtn${i}`);
              if (btn) { btn.disabled = false; btn.classList.add('spinning'); }
            });
            if (isAutoMode) this.scheduleAutoStop();
          };

          // 計算されたウェイト待機時間（0〜4.1秒）満了後にリール始動
          setTimeout(() => {
            if (premiumMode === 'FREEZE') {
              setTimeout(() => {
                if (lampWait) lampWait.classList.remove('active');
                startReelAnimation();
              }, 600);
            } else {
              if (lampWait) {
                if (waitDelay > 0) lampWait.classList.remove('active');
                else setTimeout(() => lampWait.classList.remove('active'), 250);
              }
              startReelAnimation();
            }
          }, waitDelay);
        };

        if (autoRefillHappened) {
          const startCredits = credits;
          const targetCredits = 50;
          let currentStep = 0;
          const refillInterval = setInterval(() => {
            currentStep++;
            credits = Math.min(targetCredits, startCredits + Math.round((targetCredits - startCredits) * (currentStep / 5)));
            updateDisplays(0);
            if (window.SLOT_SOUND) window.SLOT_SOUND.play('bet');
            if (currentStep >= 5) {
              clearInterval(refillInterval); credits = targetCredits; updateDisplays(0);
              setTimeout(executeSpinSequence, 100);
            }
          }, 60);
        } else {
          executeSpinSequence();
        }
      } catch (e) { gameState = STATE_IDLE; }
    },

    stopReelIndex: function(index, isAutoCall = false) {
      if (gameState !== STATE_SPINNING) return;
      if (!isAutoCall && isTouchActive && hasActionExecutedInCurrentTouch) return;

      const reel = reels[index];
      if (!reel || !reel.isSpinning || reel.isStopping) return;

      try {
        if (!isAutoCall && autoTimer) { clearTimeout(autoTimer); autoTimer = null; }

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

        let targetSyms = [];
        if (isBonusMode) {
          if (currentFlag === 'CHERRY') targetSyms = (index === 0) ? ['CHERRY'] : [];
          else targetSyms = ['GRAPE'];
        } else {
          if (currentFlag === 'BIG' || currentFlag === 'REG') {
              // ペカ前は直揃い禁止のため、狙い図柄を空にして命令矛盾(フリーズ)を完全に回避
              targetSyms = []; 
          } else if (currentFlag && currentFlag.includes('CHERRY')) {
              targetSyms = (index === 0) ? ['CHERRY'] : [];
          } else if (currentFlag === 'REPLAY') targetSyms = ['RHINO'];
          else if (currentFlag === 'GRAPE') targetSyms = ['GRAPE'];
          else if (currentFlag === 'BELL') targetSyms = ['BELL'];
          else if (currentFlag === 'CLOWN') targetSyms = ['CLOWN'];
          else if (!currentFlag && bonusFlag) {
            // ペカ後は完全オート目押しでボーナス図柄を強制引き込み
            if (bonusFlag === 'BIG' || bonusFlag === 'CHERRY_BIG') targetSyms = ['7'];
            else if (bonusFlag === 'REG' || bonusFlag === 'CHERRY_REG') targetSyms = (index === 2) ? ['BAR'] : ['7'];
          }
        }

        // 完全オート目押しの絶対保護 (ナレッジ絶対防衛)
        let slipLimit = 4;
        if (currentFlag || bonusFlag || isBonusMode) {
            slipLimit = 21; 
        }

        // 実機準拠：ボーナス消化中およびペカ後のボーナス揃いゲーム（1枚掛け）は「中段1ラインのみ」で引き込み計算
        const isOneBetGame = isBonusMode || Boolean(bonusFlag);
        const lineOffsets = isOneBetGame
          ? [[1, 1, 1]]  // 1枚掛け：中段1ライン限定（上段・斜め等への誤揃いを100%遮断）
          : [            // 通常時（3枚掛け）：全5ライン（斜め含む）で従来の引き込みを100%完全保持
              [0, 0, 0], [1, 1, 1], [2, 2, 2], [0, 1, 2], [2, 1, 0]
            ];

        let finalSlip = 0;
        let foundValid = false;

        const getSym = (r, idx, offset) => reels[r].strip[(idx + offset) % reels[r].strip.length];
        const isStopped = (r) => (r === index) ? true : (!reels[r].isSpinning || reels[r].isStopping);
        const currentIdxFn = (r, checkIdx) => (r === index) ? checkIdx : reels[r].currentIndex;

        // チェリーフラグ判定および左リールチェリー露出チェック用ヘルパー
        const isCherryFlag = Boolean(currentFlag && currentFlag.includes('CHERRY'));
        const isLeftReelShowingCherry = (checkIdx0) => {
          const s0 = getSym(0, checkIdx0, 0);
          const s1 = getSym(0, checkIdx0, 1);
          const s2 = getSym(0, checkIdx0, 2);
          return (s0 === 'CHERRY' || s1 === 'CHERRY' || s2 === 'CHERRY');
        };

        // 単独ボーナス成立時（ペカ前）のリーチ目スコアリング関数
        const isSingleBonusPekaBefore = Boolean((currentFlag === 'BIG' || currentFlag === 'REG') && !isBonusMode);
        const calculateReachScore = (checkIdx) => {
          if (!isSingleBonusPekaBefore) return 0;
          let score = 0;
          const stoppedSyms = [0, 1, 2].map(r => {
            const cIdx = (r === index) ? checkIdx : reels[r].currentIndex;
            return [getSym(r, cIdx, 0), getSym(r, cIdx, 1), getSym(r, cIdx, 2)];
          });

          // 1. 枠内のボーナス図柄（7, BAR）の個数
          let bonusSymbolCount = 0;
          for (let r = 0; r < 3; r++) {
            if (isStopped(r)) {
              for (let o = 0; o < 3; o++) {
                if (stoppedSyms[r][o] === '7' || stoppedSyms[r][o] === 'BAR') bonusSymbolCount++;
              }
            }
          }
          score += bonusSymbolCount * 10;

          // 2. ハサミ対角線・平行のボーナス図柄配置（アツいリーチ目形成）
          if (isStopped(0) && isStopped(2)) {
            const leftTop = stoppedSyms[0][0], leftBottom = stoppedSyms[0][2];
            const rightTop = stoppedSyms[2][0], rightBottom = stoppedSyms[2][2];
            const isBonusSym = (s) => (s === '7' || s === 'BAR');

            // 対角線（左上＋右下、または左下＋右上）
            if ((isBonusSym(leftTop) && isBonusSym(rightBottom)) || (isBonusSym(leftBottom) && isBonusSym(rightTop))) {
              score += 50;
            }
            // 平行（上段同士、または下段同士）
            if ((isBonusSym(leftTop) && isBonusSym(rightTop)) || (isBonusSym(leftBottom) && isBonusSym(rightBottom))) {
              score += 30;
            }
          }

          // 3. 2連テンパイ（7-7, 7-BAR等）
          if (isStopped(0) && isStopped(1)) {
            for (let line of lineOffsets) {
              const s0 = stoppedSyms[0][line[0]];
              const s1 = stoppedSyms[1][line[1]];
              if ((s0 === '7' || s0 === 'BAR') && (s1 === '7' || s1 === 'BAR')) {
                score += 40;
              }
            }
          }

          return score;
        };

        // 禁じ手チェック関数 (直揃い禁止・誤揃い防止)
        const checkFinalState = (syms) => {
            if (!currentFlag && !bonusFlag) {
                if (syms[0] === syms[1] && syms[1] === syms[2]) return false;
                if (syms[0] === '7' && syms[1] === '7' && syms[2] === 'BAR') return false;
            }
            if (currentFlag && !isBonusMode) {
                if (['GRAPE', 'REPLAY', 'BELL', 'CLOWN', 'CHERRY'].includes(currentFlag)) {
                     if (syms[0] === syms[1] && syms[1] === syms[2] && (syms[0] === '7' || syms[0] === 'BAR')) return false;
                     if (syms[0] === '7' && syms[1] === '7' && syms[2] === 'BAR') return false;
                }
                if (currentFlag !== 'GRAPE' && syms[0] === syms[1] && syms[1] === syms[2] && syms[0] === 'GRAPE') return false;
                if (currentFlag !== 'REPLAY' && syms[0] === syms[1] && syms[1] === syms[2] && syms[0] === 'RHINO') return false;
                if (currentFlag !== 'BELL' && syms[0] === syms[1] && syms[1] === syms[2] && syms[0] === 'BELL') return false;
                if (currentFlag !== 'CLOWN' && syms[0] === syms[1] && syms[1] === syms[2] && syms[0] === 'CLOWN') return false;
            }
            // 直揃い禁止絶対保護 (単独ボーナス成立ゲーム: ペカ前)
            if (currentFlag && !isBonusMode && (currentFlag.includes('CHERRY_') || currentFlag === 'BIG' || currentFlag === 'REG')) {
                if (syms[0] === syms[1] && syms[1] === syms[2] && (syms[0] === '7' || syms[0] === 'BAR')) return false;
                if (syms[0] === '7' && syms[1] === '7' && syms[2] === 'BAR') return false;
            }
            return true;
        };

        const stoppedCount = [0, 1, 2].filter(r => isStopped(r)).length;

        let bestReachScore = -1;

        for (let slip = 0; slip <= 21; slip++) {
            const checkIdx = (baseIdx - slip + reel.strip.length) % reel.strip.length;
            let isValid = true;
            let isTargetMatched = false;

            // 非チェリー成立時：左リール枠内（上中下）にチェリーが露出する停止位置を排除（実機出目美観適合）
            if (!isCherryFlag && index === 0 && isLeftReelShowingCherry(checkIdx)) {
              isValid = false;
            }

            // ① 狙い図柄の引き込み評価
            if (isValid && targetSyms.length > 0) {
                for (let l = 0; l < lineOffsets.length; l++) {
                    let lineValid = true;
                    let hasTarget = false;
                    for (let i = 0; i < 3; i++) {
                        if (isStopped(i)) {
                            const sym = getSym(i, currentIdxFn(i, checkIdx), lineOffsets[l][i]);
                            if (currentFlag && currentFlag.includes('CHERRY')) {
                                if (i === 0) {
                                    if (!targetSyms.includes(sym)) lineValid = false;
                                    else hasTarget = true;
                                }
                            } else {
                                if (!targetSyms.includes(sym)) lineValid = false;
                                else hasTarget = true;
                            }
                        }
                    }
                    if (lineValid && hasTarget) { isTargetMatched = true; break; }
                }
                if (!isTargetMatched) isValid = false;
            }

            // ② ハサミ打ち・変則押し完全対応 先読みシミュレート (詰み・チェリー取りこぼし防止)
            if (isValid) {
                if (stoppedCount === 3) {
                     for (let l = 0; l < lineOffsets.length; l++) {
                         const syms = [
                             getSym(0, currentIdxFn(0, checkIdx), lineOffsets[l][0]),
                             getSym(1, currentIdxFn(1, checkIdx), lineOffsets[l][1]),
                             getSym(2, currentIdxFn(2, checkIdx), lineOffsets[l][2])
                         ];
                         if (!checkFinalState(syms)) { isValid = false; break; }
                     }
                } else if (stoppedCount === 2) {
                     const remainingReelId = [0, 1, 2].find(r => !isStopped(r));
                     let canSaveAllLines = false;
                     
                     for (let remIdx = 0; remIdx < 21; remIdx++) {
                         let allLinesSafeForThisRemIdx = true;

                         // 残りが左リールかつ非チェリー時、枠内にチェリーが出るremIdxを排除
                         if (!isCherryFlag && remainingReelId === 0 && isLeftReelShowingCherry(remIdx)) {
                           allLinesSafeForThisRemIdx = false;
                         } else {
                           for (let l = 0; l < lineOffsets.length; l++) {
                               const syms = [
                                   getSym(0, remainingReelId === 0 ? remIdx : currentIdxFn(0, checkIdx), lineOffsets[l][0]),
                                   getSym(1, remainingReelId === 1 ? remIdx : currentIdxFn(1, checkIdx), lineOffsets[l][1]),
                                   getSym(2, remainingReelId === 2 ? remIdx : currentIdxFn(2, checkIdx), lineOffsets[l][2])
                               ];
                               if (!checkFinalState(syms)) { allLinesSafeForThisRemIdx = false; break; }
                           }
                         }
                         
                         // 逆押し時のチェリー・小役 先読みシミュレート追加
                         if (allLinesSafeForThisRemIdx) {
                             let hasTargetInRem = false;
                             let checkTarget = false;
                             
                             // チェリーフラグで、まだ左リールが止まっていない場合
                             if (currentFlag && currentFlag.includes('CHERRY') && remainingReelId === 0) {
                                 checkTarget = true;
                                 for (let l = 0; l < lineOffsets.length; l++) {
                                     const sym0 = getSym(0, remIdx, lineOffsets[l][0]);
                                     if (sym0 === 'CHERRY') { hasTargetInRem = true; break; }
                                 }
                             } else if (targetSyms.length > 0 && !isBonusMode && currentFlag !== 'BIG' && currentFlag !== 'REG') {
                                 checkTarget = true;
                                 for (let l = 0; l < lineOffsets.length; l++) {
                                     const syms = [
                                         getSym(0, remainingReelId === 0 ? remIdx : currentIdxFn(0, checkIdx), lineOffsets[l][0]),
                                         getSym(1, remainingReelId === 1 ? remIdx : currentIdxFn(1, checkIdx), lineOffsets[l][1]),
                                         getSym(2, remainingReelId === 2 ? remIdx : currentIdxFn(2, checkIdx), lineOffsets[l][2])
                                     ];
                                     if (syms[0] === syms[1] && syms[1] === syms[2] && targetSyms.includes(syms[0])) { hasTargetInRem = true; break; }
                                 }
                             }

                             if (checkTarget && !hasTargetInRem) {
                                 allLinesSafeForThisRemIdx = false;
                             }
                         }
                         
                         if (allLinesSafeForThisRemIdx) { canSaveAllLines = true; break; }
                     }
                     if (!canSaveAllLines) isValid = false;
                }
            }

            if (isValid) {
                // 単独ボーナス時（ペカ前）はスコアの高いリーチ目を優先選択
                if (isSingleBonusPekaBefore) {
                  const reachScore = calculateReachScore(checkIdx);
                  if (reachScore > bestReachScore) {
                    bestReachScore = reachScore;
                    finalSlip = slip;
                    foundValid = true;
                  }
                } else {
                  if (slip <= slipLimit) { finalSlip = slip; foundValid = true; break; } 
                  else if (!foundValid) { finalSlip = slip; foundValid = true; } 
                }
            }
        }
        
        let targetIdx = (baseIdx - finalSlip + reel.strip.length) % reel.strip.length;
        reel.currentIndex = targetIdx;
        reel.targetPos = targetIdx * SYMBOL_HEIGHT;

        if (index === 2 && !isBonusMode && bonusFlag && pekaTiming === 'STOP3_UP') triggerPeka();
      } catch (e) {}
    },

    handleTap: function() {
      if (!this.isInitialized) return;
      if (isAutoMode) stopAutoMode();
      if (gameState === STATE_IDLE) { this.startSpin(); } 
      else if (gameState === STATE_SPINNING) {
        for (let i = 0; i < 3; i++) {
          if (reels[i].isSpinning && !reels[i].isStopping) { this.stopReelIndex(i, false); break; }
        }
      }
    },

    bindEvents: function() {
      const startTouchSession = () => { isTouchActive = true; if (window.SLOT_SOUND) window.SLOT_SOUND.preload(); };
      const endTouchSession = () => { isTouchActive = false; hasActionExecutedInCurrentTouch = false; };
      document.addEventListener('touchstart', startTouchSession, { passive: true });
      document.addEventListener('touchend', endTouchSession, { passive: true });
      document.addEventListener('touchcancel', endTouchSession, { passive: true });
      document.addEventListener('mousedown', startTouchSession, { passive: true });
      document.addEventListener('mouseup', endTouchSession, { passive: true });

      // ストップボタン個別のイベント処理（変則打ち対応＆イベント伝播遮断＆AUTO時手動タップ安全解除）
      [0, 1, 2].forEach(i => {
        const btn = document.getElementById(`stopBtn${i}`);
        if (btn) {
          const handleStopBtn = (e) => {
            if (e) {
              e.stopPropagation();
              if (e.cancelable) e.preventDefault();
            }
            if (isAutoMode) stopAutoMode(); // AUTO時に個別ボタンを手動タップした際、安全にAUTO解除（MANUAL復帰）
            if (gameState === STATE_SPINNING) {
              this.stopReelIndex(i, false);
            }
          };
          btn.addEventListener('touchstart', handleStopBtn, { passive: false });
          btn.addEventListener('click', handleStopBtn);
        }
      });

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

    // 案A改修：ペカ後ボーナス揃いゲーム時、ターゲット図柄(7/BAR)が中段ラインへ引き込める滑りコマ数(0〜3コマ)を直接計算して狙い打ち
    scheduleAutoStop: function() {
      if (!isAutoMode || gameState !== STATE_SPINNING) return;
      if (autoTimer) clearTimeout(autoTimer);

      let step = 0; // 0: 左待機, 1: 左停止後ウェイト, 2: 中待機, 3: 中停止後ウェイト, 4: 右待機

      // 目押しターゲット(7/BAR)が中段ラインにすっと引き込める必要滑りコマ数 neededSlip (0〜3コマ) を直接算出する完全判定関数
      const isTargetInAimRange = (reelIndex, targetSyms) => {
        const reel = reels[reelIndex];
        if (!reel) return true;
        const len = reel.strip.length;
        let baseIdx = Math.floor(reel.pos / SYMBOL_HEIGHT) % len;
        if (baseIdx < 0) baseIdx += len;

        for (let i = 0; i < len; i++) {
          if (targetSyms.includes(reel.strip[i])) {
            // ターゲット i を中段(baseIdx + 1)へ止めるために必要な滑りコマ数 neededSlip
            let neededSlip = (baseIdx + 1 - i + len) % len;
            if (neededSlip <= 3) return true; // 実機通りの引き込み可能範囲(0〜3コマ)内ならストップ！
          }
        }
        return false;
      };

      const runAutoStep = () => {
        if (!isAutoMode || gameState !== STATE_SPINNING) return;

        // ペカ後かつハサミ・小役未成立(＝ボーナスが揃うハズレG)かどうかの判定
        const isBonusAimGame = Boolean(!isBonusMode && bonusFlag && !currentFlag);

        // 【左リール(0)処理】
        if (reels[0].isSpinning) {
          if (!reels[0].isStopping) {
            if (isBonusAimGame) {
              const targets = ['7'];
              if (!isTargetInAimRange(0, targets)) {
                autoTimer = setTimeout(runAutoStep, 30); // ベスト位置まで高速監視ループ
                return;
              }
            }
            this.stopReelIndex(0, true);
          }
          autoTimer = setTimeout(runAutoStep, 40);
          return;
        }

        // 左が完全停止した直後の自然な「間（220ms）」
        if (step === 0) {
          step = 1;
          autoTimer = setTimeout(runAutoStep, 220);
          return;
        }

        // 【中リール(1)処理】
        if (reels[1].isSpinning) {
          if (!reels[1].isStopping) {
            if (isBonusAimGame) {
              const targets = ['7'];
              if (!isTargetInAimRange(1, targets)) {
                autoTimer = setTimeout(runAutoStep, 30); // ベスト位置まで高速監視ループ
                return;
              }
            }
            this.stopReelIndex(1, true);
          }
          autoTimer = setTimeout(runAutoStep, 40);
          return;
        }

        // 中が完全停止した直後の自然な「間（220ms）」
        if (step === 1) {
          step = 2;
          autoTimer = setTimeout(runAutoStep, 220);
          return;
        }

        // 【右リール(2)処理】
        if (reels[2].isSpinning) {
          if (!reels[2].isStopping) {
            if (isBonusAimGame) {
              const targets = (bonusFlag === 'REG' || bonusFlag === 'CHERRY_REG') ? ['BAR'] : ['7'];
              if (!isTargetInAimRange(2, targets)) {
                autoTimer = setTimeout(runAutoStep, 30); // ベスト位置まで高速監視ループ
                return;
              }
            }
            this.stopReelIndex(2, true);
          }
          autoTimer = setTimeout(runAutoStep, 40);
          return;
        }
      };

      // スピン開始後 250ms で最初の左リールストップを呼び出し
      autoTimer = setTimeout(runAutoStep, 250);
    },

    spinReel: function(reel) {
      const maxPos = reel.strip.length * SYMBOL_HEIGHT;
      const animate = () => {
        if (!reel.isSpinning) return;
        if (reel.isStopping) {
          let dist = (reel.pos - reel.targetPos + maxPos) % maxPos;
          if (dist <= reel.speed || dist < 2) {
            reel.pos = reel.targetPos; reel.isSpinning = false; reel.isStopping = false;
            if (reel.animId) { cancelAnimationFrame(reel.animId); reel.animId = null; }
            reel.canvas.style.transform = `translateY(-${reel.pos}px)`;
            if (window.REEL_RENDERER) window.REEL_RENDERER.renderReelCanvas(reel, false);
            if (activeReelsCount === 0) this.onAllStopped();
            return;
          } else reel.pos = (reel.pos - Math.min(reel.speed, dist) + maxPos) % maxPos;
        } else reel.pos = (reel.pos - reel.speed + maxPos) % maxPos;
        reel.canvas.style.transform = `translateY(-${reel.pos}px)`;
        reel.animId = requestAnimationFrame(animate);
      };
      animate();
    },

    onAllStopped: function() {
      gameState = STATE_IDLE; betAmount = 0;
      const getSym = (rIdx, offset) => { const strip = reels[rIdx].strip; return strip[(reels[rIdx].currentIndex + offset + strip.length) % strip.length]; };
      const lines = [
        [getSym(0, 0), getSym(1, 0), getSym(2, 0)], [getSym(0, 1), getSym(1, 1), getSym(2, 1)], [getSym(0, 2), getSym(1, 2), getSym(2, 2)],
        [getSym(0, 0), getSym(1, 1), getSym(2, 2)], [getSym(0, 2), getSym(1, 1), getSym(2, 0)]
      ];

      // 実機準拠：ボーナス消化中およびペカ後のボーナス揃いゲーム（1枚掛け）は「中段1ライン（lines[1]）のみ」で入賞判定
      const isOneBetGame = isBonusMode || Boolean(bonusFlag);
      let activeLines = isOneBetGame ? [lines[1]] : lines;
      let payout = 0;
      let isBigWin = false, isRegWin = false, isReplayWin = false;
      let playSoundType = 'bonus_pay';
      let grapeWin = false, cherryWin = false, bellWin = false, clownWin = false;

      activeLines.forEach(line => {
        if (line.every(s => s === '7')) isBigWin = true;
        else if (line[0] === '7' && line[1] === '7' && line[2] === 'BAR') isRegWin = true;
        else if (line.every(s => s === 'RHINO')) isReplayWin = true;
        else if (line.every(s => s === 'GRAPE')) grapeWin = true;
        else if (line[0] === 'CHERRY') cherryWin = true;
        else if (line.every(s => s === 'BELL')) bellWin = true; 
        else if (line.every(s => s === 'CLOWN')) clownWin = true;
      });

      // ボーナス中の全小役払出一元化 (純増計算保護)
      if (isBonusMode) {
          if (grapeWin || cherryWin || bellWin || clownWin || isReplayWin) {
              payout = bonusType === 'BIG' ? 15 : 13;
              playSoundType = grapeWin ? 'grape' : (cherryWin ? 'cherry' : 'bell_clown');
              if (isReplayWin) playSoundType = 'replay';
          }
      } else {
          if (grapeWin) { payout = 8; playSoundType = 'grape'; }
          if (cherryWin) { payout = Math.max(payout, 2); playSoundType = 'cherry'; }
          if (bellWin) { payout = Math.max(payout, 14); playSoundType = 'bell_clown'; }
          if (clownWin) { payout = Math.max(payout, 10); playSoundType = 'bell_clown'; }
      }

      if (payout > 0) {
        credits += payout;
        if (credits > 50) credits = 50; 
        if (window.DATA_COUNTER) window.DATA_COUNTER.onPayout(payout, grapeWin ? (isBonusMode ? 'BONUS_GRAPE' : 'GRAPE') : 'OTHER');
        if (window.SLOT_SOUND) window.SLOT_SOUND.play(playSoundType);
      }

      if (isBonusMode) {
        if (payout > 0) bonusAcquired += payout;
        if (bonusAcquired >= bonusTarget) {
          isBonusMode = false; bonusFlag = null; currentFlag = null; gamesSinceLastBonus = 0;
          if (window.DATA_COUNTER && typeof window.DATA_COUNTER.onBonusEnd === 'function') window.DATA_COUNTER.onBonusEnd(); 
          if (window.SLOT_SOUND) window.SLOT_SOUND.stopBGM();
        }
        setLineBadgesLit(true); updateDisplays(payout);
        if (isAutoMode) setTimeout(() => { if (isAutoMode) this.startSpin(); }, 400);
        return;
      }

      const justWonBonus = (isBigWin || isRegWin);

      // 音響・次ゲーム進行シーケンスチェーンの固定
      if (isBigWin) {
        isBonusMode = true; bonusType = 'BIG'; bonusAcquired = 0; bonusTarget = 266;
        const is1GWin = (gamesSinceLastBonus === 1);
        const isZoromeWin = (gamesSinceLastBonus <= 100 && gamesSinceLastBonus > 0 && gamesSinceLastBonus % 11 === 0);
        bonusFlag = null; currentFlag = null; 
        if (window.DATA_COUNTER) window.DATA_COUNTER.onBonusWin('BIG');
        turnOffGogoLamp();
        if (window.SLOT_SOUND) {
          window.SLOT_SOUND.play('big_fanfare');
          setTimeout(() => { window.SLOT_SOUND.playBGM(is1GWin || isZoromeWin ? 'BIG_SPECIAL' : 'BIG'); }, 1500);
        }
        if (autoStopOnBonus) stopAutoMode();
      } else if (isRegWin) {
        // ナレッジ絶対保護: 13枚払出 × 8ゲーム ＝ ターゲット104 (純増96枚ピッタリ計算)
        isBonusMode = true; bonusType = 'REG'; bonusAcquired = 0; bonusTarget = 104;
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
        let nextDelay = isReplayWin ? 150 : 450;
        // 案2採用：①7揃い ➔ ②ファンファーレ/メロディ再生 ➔ ③3.5秒(3500ms)の出目目視確認静止時間 ➔ ④1枚掛けレバーオン の順序を100%固定保証
        if (justWonBonus && !autoStopOnBonus) nextDelay = 3500;
        setTimeout(() => { if (isAutoMode && gameState === STATE_IDLE) this.startSpin(); }, nextDelay);
      }
    }
  };
})();

