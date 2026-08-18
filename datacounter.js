/**
 * データカウンターモジュール (datacounter.js)
 * IN/OUT集計・精密差枚数管理・機械割(RTP)算出・全件履歴保持・可変スランプグラフ描画
 */

(function() {
  const DataCounter = {
    totalGames: 0,       // 通常時の総回転数
    currentGames: 0,     // 現在のボーナス間ゲーム数
    bigCount: 0,         // BIG回数
    regCount: 0,         // REG回数
    grapeCount: 0,       // 通常時のブドウ獲得回数
    diffMedal: 0,        // 累計差枚数（純差枚数）
    
    totalIn: 0,          // 累計投入枚数 (IN)
    totalOut: 0,         // 累計払出枚数 (OUT)
    
    history: [],         // 当選履歴リスト [{ id, type, game, totalGame, time }]
    slumpData: [{ game: 0, diff: 0 }], // スランプグラフ用データポイント

    init: function() {
      this.reset();
    },

    reset: function() {
      this.totalGames = 0;
      this.currentGames = 0;
      this.bigCount = 0;
      this.regCount = 0;
      this.grapeCount = 0;
      this.diffMedal = 0;
      this.totalIn = 0;
      this.totalOut = 0;
      this.history = [];
      this.slumpData = [{ game: 0, diff: 0 }];
    },

    // 1ゲーム開始時 (BET消費時)
    onGameStart: function(betCount, isBonusMode = false) {
      if (betCount > 0) {
        this.totalIn += betCount;
        
        if (!isBonusMode) {
          this.totalGames++;
          this.currentGames++;
        }
        this.diffMedal -= betCount;
        this.recordSlumpPoint();
      }
    },

    // 払い出し発生時
    onPayout: function(payout, type = '') {
      if (payout > 0) {
        this.totalOut += payout;
        this.diffMedal += payout;
        
        if (type === 'GRAPE') {
          this.grapeCount++;
        }
        this.recordSlumpPoint();
      }
    },

    // ボーナス当選時記録
    onBonusWin: function(type) {
      if (type === 'BIG') {
        this.bigCount++;
      } else if (type === 'REG') {
        this.regCount++;
      }

      const now = new Date();
      const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

      this.history.unshift({
        id: this.history.length + 1,
        type: type,
        game: this.currentGames,
        totalGame: this.totalGames,
        time: timeStr
      });

      this.currentGames = 0;
      this.recordSlumpPoint(true);
    },

    // スランプグラフ用データポイントの記録
    recordSlumpPoint: function(forceRecord = false) {
      const lastPoint = this.slumpData[this.slumpData.length - 1];
      
      if (forceRecord || !lastPoint || (this.totalGames - lastPoint.game >= 5) || Math.abs(this.diffMedal - lastPoint.diff) >= 10) {
        this.slumpData.push({
          game: this.totalGames,
          diff: this.diffMedal
        });
      }
    },

    // 統計・計算結果データの取得
    getStats: function() {
      const formatProb = (count, total) => {
        if (count === 0 || total === 0) return '1/--.-';
        return `1/${(total / count).toFixed(1)}`;
      };

      const formatProbPrecise = (count, total) => {
        if (count === 0 || total === 0) return '1/--.--';
        return `1/${(total / count).toFixed(2)}`;
      };

      const totalBonus = this.bigCount + this.regCount;
      const rtp = this.totalIn > 0 ? ((this.totalOut / this.totalIn) * 100).toFixed(1) + '%' : '--.-%';

      return {
        totalGames: this.totalGames,
        currentGames: this.currentGames,
        bigCount: this.bigCount,
        regCount: this.regCount,
        totalBonus: totalBonus,
        bigProb: formatProb(this.bigCount, this.totalGames),
        regProb: formatProb(this.regCount, this.totalGames),
        totalProb: formatProb(totalBonus, this.totalGames),
        grapeProb: formatProbPrecise(this.grapeCount, this.totalGames),
        diffMedal: this.diffMedal,
        totalIn: this.totalIn,
        totalOut: this.totalOut,
        rtp: rtp
      };
    },

    // スランプグラフ描画
    renderSlumpGraph: function(canvasElement) {
      if (!canvasElement) return;
      const ctx = canvasElement.getContext('2d');
      const width = canvasElement.width;
      const height = canvasElement.height;

      if (width === 0 || height === 0) return;

      ctx.fillStyle = '#111622';
      ctx.fillRect(0, 0, width, height);

      const padding = { top: 25, right: 20, bottom: 25, left: 48 };
      const graphWidth = width - padding.left - padding.right;
      const graphHeight = height - padding.top - padding.bottom;

      let maxDiff = 500;
      let minDiff = -500;

      this.slumpData.forEach(p => {
        if (p.diff > maxDiff) maxDiff = Math.ceil(p.diff / 250) * 250;
        if (p.diff < minDiff) minDiff = Math.floor(p.diff / 250) * 250;
      });

      const absMax = Math.max(Math.abs(maxDiff), Math.abs(minDiff), 500);
      maxDiff = absMax;
      minDiff = -absMax;

      const maxGame = Math.max(3000, this.totalGames + 200);

      const zeroY = padding.top + graphHeight * (maxDiff / (maxDiff - minDiff));

      ctx.strokeStyle = '#2a3447';
      ctx.lineWidth = 1;
      
      const gridStepY = (maxDiff - minDiff) / 4;
      for (let i = 0; i <= 4; i++) {
        const val = maxDiff - (gridStepY * i);
        const y = padding.top + graphHeight * ((maxDiff - val) / (maxDiff - minDiff));
        
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(width - padding.right, y);
        ctx.stroke();

        ctx.fillStyle = '#7a8ba6';
        ctx.font = '10px monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText((val > 0 ? '+' : '') + Math.round(val), padding.left - 5, y);
      }

      ctx.strokeStyle = '#ff4444';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(padding.left, zeroY);
      ctx.lineTo(width - padding.right, zeroY);
      ctx.stroke();

      if (this.slumpData.length > 1) {
        ctx.strokeStyle = '#00e5ff';
        ctx.lineWidth = 2;
        ctx.beginPath();

        this.slumpData.forEach((point, idx) => {
          const x = padding.left + (point.game / maxGame) * graphWidth;
          const y = padding.top + graphHeight * ((maxDiff - point.diff) / (maxDiff - minDiff));

          if (idx === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        });
        ctx.stroke();

        const lastPoint = this.slumpData[this.slumpData.length - 1];
        const lastX = padding.left + (lastPoint.game / maxGame) * graphWidth;
        const lastY = padding.top + graphHeight * ((maxDiff - lastPoint.diff) / (maxDiff - minDiff));

        ctx.fillStyle = '#ffeb3b';
        ctx.beginPath();
        ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = '#a0b0c8';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('通常ゲーム数(G)', padding.left + graphWidth / 2, height - 6);
    },

    // 当選履歴テーブルHTMLの出力
    renderHistoryHTML: function() {
      if (this.history.length === 0) {
        return '<div style="text-align:center; padding:20px; color:#666;">当選履歴はありません</div>';
      }

      let html = `<table class="history-table">
        <thead>
          <tr>
            <th>No.</th>
            <th>種別</th>
            <th>当選G数</th>
            <th>累計G</th>
            <th>時刻</th>
          </tr>
        </thead>
        <tbody>`;

      this.history.forEach((h, idx) => {
        const typeClass = h.type === 'BIG' ? 'badge-big' : 'badge-reg';
        html += `
          <tr>
            <td>${this.history.length - idx}</td>
            <td><span class="${typeClass}">${h.type}</span></td>
            <td style="font-weight:bold; color:#ffcc00;">${h.game}G</td>
            <td>${h.totalGame}G</td>
            <td>${h.time}</td>
          </tr>
        `;
      });

      html += '</tbody></table>';
      return html;
    }
  };

  window.DATA_COUNTER = DataCounter;
})();

