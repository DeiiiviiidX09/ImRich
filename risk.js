
/*
 * TRADE AI
 * Gestor de riesgo v5.0
 *
 * Simulación exclusivamente.
 *
 * - Objetivo de beneficio por ciclo: +$0.20.
 * - Pérdida máxima por ciclo: -$5.00.
 * - Apalancamiento: 1:30.
 * - El balance se actualiza con el resultado neto del ciclo.
 */

const TradeRisk = (() => {

    const CONFIG = {
        profitTargetUSD: 0.20,
        maxLossUSD: 5.00,
        leverage: 30
    };

    function createManager() {

        let startingBalance = 0;
        let currentBalance = 0;
        let cycleProfitLoss = 0;
        let cycleNumber = 0;
        let cycleStatus = "INACTIVE";
        let startedAt = null;
        let finishedAt = null;

        function startCycle(capital) {

            const amount = Number(capital);

            if (!Number.isFinite(amount) || amount <= 0) {
                throw new Error(
                    "El capital inicial debe ser un número positivo."
                );
            }

            startingBalance = amount;
            currentBalance = amount;
            cycleProfitLoss = 0;
            cycleNumber = 1;
            cycleStatus = "ACTIVE";
            startedAt = new Date().toISOString();
            finishedAt = null;

            return getStatus();
        }

        function updateCycleProfitLoss(value) {

            const result = Number(value);

            if (!Number.isFinite(result)) {
                return getStatus();
            }

            cycleProfitLoss = result;
            currentBalance = startingBalance + cycleProfitLoss;

            if (cycleStatus !== "ACTIVE") {
                return getStatus();
            }

            if (cycleProfitLoss >= CONFIG.profitTargetUSD) {

                cycleStatus = "TAKE_PROFIT";
                finishedAt = new Date().toISOString();

            } else if (cycleProfitLoss <= -CONFIG.maxLossUSD) {

                cycleStatus = "LOSS_LIMIT";
                finishedAt = new Date().toISOString();
            }

            return getStatus();
        }

        function resetCycle(remainingBalance) {

            const amount = Number(remainingBalance);

            if (!Number.isFinite(amount) || amount <= 0) {
                throw new Error(
                    "No hay balance válido para iniciar el siguiente ciclo."
                );
            }

            startingBalance = amount;
            currentBalance = amount;
            cycleProfitLoss = 0;
            cycleNumber += 1;
            cycleStatus = "ACTIVE";
            startedAt = new Date().toISOString();
            finishedAt = null;

            return getStatus();
        }

        function getStatus() {

            const profitProgress =
                CONFIG.profitTargetUSD > 0
                    ? Math.max(
                        0,
                        (cycleProfitLoss / CONFIG.profitTargetUSD) * 100
                    )
                    : 0;

            const lossProgress =
                CONFIG.maxLossUSD > 0
                    ? Math.max(
                        0,
                        (Math.abs(Math.min(0, cycleProfitLoss)) /
                            CONFIG.maxLossUSD) * 100
                    )
                    : 0;

            return {
                startingBalance,
                currentBalance,
                cycleProfitLoss,
                cycleNumber,
                cycleStatus,

                profitTarget: CONFIG.profitTargetUSD,
                profitTargetUSD: CONFIG.profitTargetUSD,

                maxLoss: CONFIG.maxLossUSD,
                maxLossUSD: CONFIG.maxLossUSD,

                leverage: CONFIG.leverage,

                profitProgress,
                lossProgress,

                startedAt,
                finishedAt,

                isActive: cycleStatus === "ACTIVE",
                isTakeProfit: cycleStatus === "TAKE_PROFIT",
                isLossLimit: cycleStatus === "LOSS_LIMIT"
            };
        }

        return {
            startCycle,
            updateCycleProfitLoss,
            resetCycle,
            getStatus
        };
    }

    return {
        createManager,
        CONFIG: { ...CONFIG }
    };

})();

window.TradeRisk = TradeRisk;
