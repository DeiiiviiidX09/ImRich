
/*
 * TRADE AI
 * Gestor de riesgo v2.0
 * Solo simulación.
 */

const TradeRisk = (() => {

    function createManager() {

        const CONFIG = {
            profitTarget: 0.03,
            maxLoss: 0.01,
            leverage: 10
        };

        let cycleStartBalance = 100;
        let cycleProfitLoss = 0;
        let cycleNumber = 1;
        let cycleStatus = "ACTIVE";

        function startCycle(balance) {

            if (!Number.isFinite(balance) || balance <= 0) {
                throw new Error("Capital no válido.");
            }

            cycleStartBalance = balance;
            cycleProfitLoss = 0;
            cycleStatus = "ACTIVE";

            return getStatus();
        }

        function recordTrade(profitLoss) {

            if (cycleStatus !== "ACTIVE") {
                return getStatus();
            }

            if (!Number.isFinite(profitLoss)) {
                throw new Error("Resultado no válido.");
            }

            cycleProfitLoss += profitLoss;

            const target =
                cycleStartBalance * CONFIG.profitTarget;

            const limit =
                cycleStartBalance * CONFIG.maxLoss;

            if (cycleProfitLoss >= target) {
                cycleStatus = "TAKE_PROFIT";
            } else if (cycleProfitLoss <= -limit) {
                cycleStatus = "LOSS_LIMIT";
            }

            return getStatus();
        }

        function getStatus() {

            const profitTarget =
                cycleStartBalance * CONFIG.profitTarget;

            const lossLimit =
                cycleStartBalance * CONFIG.maxLoss;

            const currentBalance =
                cycleStartBalance + cycleProfitLoss;

            let action = "CONTINUE";

            if (cycleStatus === "TAKE_PROFIT") {
                action = "CLOSE_ALL_AND_WAIT";
            }

            if (cycleStatus === "LOSS_LIMIT") {
                action = "CLOSE_ALL_AND_RESTART";
            }

            return {
                cycleNumber,
                cycleStatus,
                action,
                startingBalance: cycleStartBalance,
                currentBalance,
                cycleProfitLoss,
                profitTarget,
                lossLimit,
                profitProgress:
                    (cycleProfitLoss / profitTarget) * 100,
                lossProgress:
                    (Math.abs(Math.min(0, cycleProfitLoss)) /
                    lossLimit) * 100,
                leverage: CONFIG.leverage
            };
        }

        function resetCycle(remainingBalance) {

            cycleNumber++;

            return startCycle(remainingBalance);
        }

        return {
            startCycle,
            recordTrade,
            getStatus,
            resetCycle
        };
    }

    // Instancia independiente para las pruebas manuales
    const testManager = createManager();

    return {
        createManager,
        startCycle: testManager.startCycle,
        recordTrade: testManager.recordTrade,
        getStatus: testManager.getStatus,
        resetCycle: testManager.resetCycle
    };

})();

window.TradeRisk = TradeRisk;
