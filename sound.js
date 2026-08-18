/**
 * 音響専門モジュール (sound.js)
 * AudioContext常時スタンバイ(プリロード)・WebAudio小役/BET/プレミア合成音・音量ON/OFF一元管理・排他BGM制御・100G以内スペシャルBGM対応
 */

(function() {
  let ctx = null;
  let masterGain = null;
  let bgmGain = null;
  const audioBuffers = {};
  
  let isAudioPreloaded = false;
  let isPlayingBGM = false;
  let currentBgmType = null; // 'BIG' | 'BIG_SPECIAL' | 'REG' | null
  let bgmTimer = null;

  let soundOn = false; // 音量は100%標準固定。ON / OFF トグルのみで一元管理

  const SoundEngine = {
    // 初回画面タップ時に裏側で無音起動してスタンバイ化（ブラウザ制限の完全突破）
    preload: function() {
      if (isAudioPreloaded) return;
      try {
        if (!ctx) {
          ctx = new (window.AudioContext || window.webkitAudioContext)();
          masterGain = ctx.createGain();
          bgmGain = ctx.createGain();
          
          masterGain.gain.setValueAtTime(soundOn ? 1.0 : 0, ctx.currentTime);
          bgmGain.gain.setValueAtTime(soundOn ? 0.35 : 0, ctx.currentTime);
          
          masterGain.connect(ctx.destination);
          bgmGain.connect(ctx.destination);
        }
        if (ctx.state === 'suspended') {
          ctx.resume();
        }
        
        // 無音バッファを再生してAudioContextを完全に動作状態にする
        const buffer = ctx.createBuffer(1, 1, 22050);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.start(0);
        
        isAudioPreloaded = true;
        this.loadExternalSounds();
      } catch (e) {}
    },

    init: function() {
      if (!isAudioPreloaded) {
        this.preload();
      } else if (ctx && ctx.state === 'suspended') {
        ctx.resume();
      }
    },

    // 設定適用時の決定音（ポーン♪）即時再生
    playConfirm: function() {
      this.init();
      if (!soundOn || !ctx) return;
      
      try {
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1046.50, now); // 高音ポーン♪
        gain.gain.setValueAtTime(0.4, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.2);
      } catch(e) {}
    },

    // ON/OFF 状態のトグル切り替え（音量スライダー廃止に伴い単純・強固化）
    setVolumeAndState: function(isSoundOn) {
      soundOn = isSoundOn;
      this.init();
      
      if (masterGain && ctx) {
        const targetVol = soundOn ? 1.0 : 0;
        masterGain.gain.setValueAtTime(targetVol, ctx.currentTime);
        bgmGain.gain.setValueAtTime(soundOn ? 0.35 : 0, ctx.currentTime);
      }

      if (soundOn) {
        this.playConfirm();
        // 無音でボーナス突入後に音をONにした場合、BGM状態を自動復帰再生
        if (currentBgmType) {
          this.playBGM(currentBgmType);
        }
      } else {
        if (bgmTimer) {
          clearTimeout(bgmTimer);
          bgmTimer = null;
        }
        isPlayingBGM = false;
      }
    },

    loadExternalSounds: function() {
      const soundFiles = {
        bet: 'sounds/bet.mp3', lever: 'sounds/lever.mp3', stop: 'sounds/stop.mp3',
        gako: 'sounds/gako.mp3', premium_freeze: 'sounds/premium_freeze.mp3',
        grape: 'sounds/grape.mp3', cherry: 'sounds/cherry.mp3',
        replay: 'sounds/replay.mp3', bell_clown: 'sounds/bell_clown.mp3',
        big_fanfare: 'sounds/big_fanfare.mp3', reg_fanfare: 'sounds/reg_fanfare.mp3',
        bonus_pay: 'sounds/bonus_pay.mp3'
      };
      Object.keys(soundFiles).forEach(key => {
        fetch(soundFiles[key]).then(res => res.ok ? res.arrayBuffer() : Promise.reject())
          .then(buf => ctx.decodeAudioData(buf)).then(decoded => { audioBuffers[key] = decoded; })
          .catch(() => {});
      });
    },

    play: function(type) {
      if (!soundOn) return;
      this.init();
      if (audioBuffers[type]) {
        try {
          const source = ctx.createBufferSource();
          source.buffer = audioBuffers[type];
          source.connect(masterGain);
          source.start(0);
          return;
        } catch(e) {}
      }
      
      // WebAudioアルペジオ本格合成音フォールバック
      try {
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(masterGain);
        
        if (type === 'bet') {
          // コイン投入・補給合成音 (チャリーン♪ 高域2音アルペジオ)
          osc.type = 'sine';
          osc.frequency.setValueAtTime(1200, now);
          osc.frequency.setValueAtTime(1600, now + 0.04);
          gain.gain.setValueAtTime(0.35, now);
          gain.gain.linearRampToValueAtTime(0, now + 0.12);
          osc.start(now); osc.stop(now + 0.12);
        } else if (type === 'lever') {
          osc.type = 'triangle'; osc.frequency.setValueAtTime(340, now); osc.frequency.exponentialRampToValueAtTime(70, now + 0.08);
          gain.gain.setValueAtTime(0.5, now); gain.gain.linearRampToValueAtTime(0.01, now + 0.08);
          osc.start(now); osc.stop(now + 0.08);
        } else if (type === 'stop') {
          osc.type = 'sine'; osc.frequency.setValueAtTime(180, now); osc.frequency.exponentialRampToValueAtTime(40, now + 0.06);
          gain.gain.setValueAtTime(0.6, now); gain.gain.linearRampToValueAtTime(0.01, now + 0.06);
          osc.start(now); osc.stop(now + 0.06);
        } else if (type === 'gako') {
          // 通常ガコッ！音
          osc.type = 'square'; osc.frequency.setValueAtTime(800, now);
          gain.gain.setValueAtTime(0.8, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
          osc.start(now); osc.stop(now + 0.15);
        } else if (type === 'premium_freeze' || type === 'gako_loud') {
          // フリーズ時・プレミアム時 重低音強烈ガコッ！＋閃光SE
          const subOsc = ctx.createOscillator();
          const subGain = ctx.createGain();
          
          osc.type = 'square';
          osc.frequency.setValueAtTime(950, now);
          osc.frequency.exponentialRampToValueAtTime(120, now + 0.25);
          gain.gain.setValueAtTime(1.0, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
          
          subOsc.type = 'sawtooth';
          subOsc.frequency.setValueAtTime(150, now);
          subOsc.frequency.exponentialRampToValueAtTime(30, now + 0.25);
          subGain.gain.setValueAtTime(0.9, now);
          subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

          osc.connect(gain); gain.connect(masterGain);
          subOsc.connect(subGain); subGain.connect(masterGain);

          osc.start(now); osc.stop(now + 0.25);
          subOsc.start(now); subOsc.stop(now + 0.25);
        } else if (type === 'big_fanfare' || type === 'reg_fanfare') {
          osc.type = 'triangle'; osc.frequency.setValueAtTime(523.25, now);
          gain.gain.setValueAtTime(0.3, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
          osc.start(now); osc.stop(now + 0.5);
        } else if (type === 'grape' || type === 'bonus_pay') {
          // ピロロピロロ♪ 合成音
          osc.type = 'sine';
          osc.frequency.setValueAtTime(659.25, now);
          osc.frequency.setValueAtTime(880.00, now + 0.05);
          osc.frequency.setValueAtTime(1046.50, now + 0.1);
          gain.gain.setValueAtTime(0.3, now);
          gain.gain.linearRampToValueAtTime(0, now + 0.2);
          osc.start(now); osc.stop(now + 0.2);
        } else if (type === 'cherry') {
          osc.type = 'square';
          osc.frequency.setValueAtTime(440, now);
          gain.gain.setValueAtTime(0.4, now);
          gain.gain.setValueAtTime(0, now + 0.05);
          gain.gain.setValueAtTime(0.4, now + 0.1);
          gain.gain.setValueAtTime(0, now + 0.15);
          osc.start(now); osc.stop(now + 0.15);
        } else if (type === 'replay') {
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(300, now);
          osc.frequency.linearRampToValueAtTime(800, now + 0.3);
          gain.gain.setValueAtTime(0.4, now);
          gain.gain.linearRampToValueAtTime(0, now + 0.3);
          osc.start(now); osc.stop(now + 0.3);
        } else if (type === 'bell_clown') {
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(1200, now);
          osc.frequency.linearRampToValueAtTime(1400, now + 0.1);
          osc.frequency.linearRampToValueAtTime(1200, now + 0.2);
          gain.gain.setValueAtTime(0.3, now);
          gain.gain.linearRampToValueAtTime(0, now + 0.3);
          osc.start(now); osc.stop(now + 0.3);
        }
      } catch(e) {}
    },

    // BGMシーケンサー (1G連/100G以内ゾロ目軍艦マーチ調BGM追加 ＆ 排他制御でタイマーリーク完全防ぎ)
    playBGM: function(type) {
      currentBgmType = type; // BGM要求状態を記録 ('BIG' | 'BIG_SPECIAL' | 'REG')
      if (!soundOn) return;
      this.init();
      this.stopBGM(false); // タイマーのみリセット（要求状態は保持）
      
      isPlayingBGM = true;
      
      // 通常BIGメロディ
      const melodyBIG = [
        [392.00, 150], [392.00, 150], [392.00, 150], [392.00, 300],
        [329.63, 300], [261.63, 300], [196.00, 300], [329.63, 300], [261.63, 300], [196.00, 300],
        [329.63, 300], [261.63, 300], [261.63, 600]
      ];

      // 100G以内プレミアムBIGメロディ (軍艦マーチ風アップテンポアルペジオ)
      const melodyBIG_SPECIAL = [
        [523.25, 120], [659.25, 120], [783.99, 120], [1046.50, 240],
        [783.99, 120], [659.25, 120], [523.25, 240], [659.25, 120], [783.99, 120],
        [880.00, 120], [880.00, 120], [880.00, 240], [783.99, 240], [659.25, 240],
        [523.25, 120], [523.25, 120], [659.25, 120], [783.99, 120], [1046.50, 480]
      ];

      // 通常REGメロディ
      const melodyREG = [
        [261.63, 300], [261.63, 300], [392.00, 300], [392.00, 300], 
        [440.00, 300], [440.00, 300], [392.00, 600]
      ];
      
      let melody = melodyBIG;
      if (type === 'BIG_SPECIAL') {
        melody = melodyBIG_SPECIAL;
      } else if (type === 'REG') {
        melody = melodyREG;
      }

      let noteIndex = 0;
      
      const playNextNote = () => {
        if (!isPlayingBGM || !soundOn || currentBgmType !== type) return;
        
        const note = melody[noteIndex];
        const freq = note[0];
        const dur = note[1];
        
        try {
          const now = ctx.currentTime;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          
          osc.type = (type === 'BIG_SPECIAL') ? 'sawtooth' : ((type === 'BIG') ? 'square' : 'triangle');
          osc.frequency.value = freq;
          
          gain.gain.setValueAtTime(0, now);
          gain.gain.linearRampToValueAtTime(type === 'BIG_SPECIAL' ? 0.22 : 0.18, now + 0.02);
          gain.gain.linearRampToValueAtTime(0, now + (dur / 1000) - 0.02);
          
          osc.connect(gain);
          gain.connect(bgmGain);
          
          osc.start(now);
          osc.stop(now + (dur / 1000));
        } catch(e) {}
        
        noteIndex = (noteIndex + 1) % melody.length;
        bgmTimer = setTimeout(playNextNote, dur);
      };
      playNextNote();
    },

    stopBGM: function(clearState = true) {
      isPlayingBGM = false;
      if (clearState) {
        currentBgmType = null;
      }
      if (bgmTimer) {
        clearTimeout(bgmTimer);
        bgmTimer = null;
      }
    }
  };

  window.SLOT_SOUND = SoundEngine;
})();

