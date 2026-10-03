
/*
 * TRADE AI
 * Gestor de riesgo v3.0
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

        // Actualizar el resultado total del ciclo.
        // Incluye operaciones cerradas y pérdidas/ganancias abiertas.
        function updateCycleProfitLoss(totalProfitLoss) {

            if (!Number.isFinite(totalProfitLoss)) {
                throw new Error("Resultado no válido.");
            }

            if (cycleStatus !== "ACTIVE") {
                return getStatus();
            }

            cycleProfitLoss = totalProfitLoss;

            checkLimits();

            return getStatus();
        }

        // Registrar un resultado adicional.
        // Se conserva para las pruebas manuales.
        function recordTrade(profitLoss) {

            if (cycleStatus !== "ACTIVE") {
                return getStatus();
            }

            if (!Number.isFinite(profitLoss)) {
                throw new Error("Resultado no válido.");
            }

            cycleProfitLoss += profitLoss;

            checkLimits();

            return getStatus();
        }

        // Comprobar los límites del ciclo.
        function checkLimits() {

            const target =
                cycleStartBalance * CONFIG.profitTarget;

            const limit =
                cycleStartBalance * CONFIG.maxLoss;

            if (cycleProfitLoss >= target) {
                cycleStatus = "TAKE_PROFIT";
            } else if (cycleProfitLoss <= -limit) {
                cycleStatus = "LOSS_LIMIT";
            }
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
            updateCycleProfitLoss,
            getStatus,
            resetCycle
        };
    }

    const testManager = createManager();

    return {
        createManager,
        startCycle: testManager.startCycle,
        recordTrade: testManager.recordTrade,
        updateCycleProfitLoss:
            testManager.updateCycleProfitLoss,
        getStatus: testManager.getStatus,
        resetCycle: testManager.resetCycle
    };

})();

window.TradeRisk = TradeRisk;
