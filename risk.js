
/*
 * TRADE AI
 * Gestor de riesgo v4.0
 * Solo simulación.
 *
 * Configuración:
 * - Capital inicial: $100
 * - Apalancamiento: 1:30
 * - Objetivo neto por ciclo: +$0.20
 * - Pérdida máxima por ciclo: -$5.00
 *
 * Los límites son cantidades fijas en USD,
 * no porcentajes del capital.
 */

const TradeRisk = (() => {

    const CONFIG = {
        profitTargetUSD: 0.20,
        maxLossUSD: 5.00,
        leverage: 30
    };

    function createManager() {

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

        /*
         * Actualiza el resultado neto total del ciclo.
         * Incluye P/L realizado, flotante y resultados
         * manuales registrados por el motor.
         */

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

        /*
         * Registrar un resultado adicional.
         * Se conserva para las pruebas manuales.
         */

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

        /*
         * Comprobar límites fijos del ciclo.
         */

        function checkLimits() {

            if (
                cycleProfitLoss >= CONFIG.profitTargetUSD
            ) {
                cycleStatus = "TAKE_PROFIT";

            } else if (
                cycleProfitLoss <= -CONFIG.maxLossUSD
            ) {
                cycleStatus = "LOSS_LIMIT";
            }
        }

        function getStatus() {

            const profitTarget =
                CONFIG.profitTargetUSD;

            const lossLimit =
                CONFIG.maxLossUSD;

            const currentBalance =
                cycleStartBalance + cycleProfitLoss;

            let action = "CONTINUE";

            if (
                cycleStatus === "TAKE_PROFIT" ||
                cycleStatus === "LOSS_LIMIT"
            ) {
                action = "CLOSE_ALL_AND_WAIT";
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
                    (
                        Math.abs(
                            Math.min(0, cycleProfitLoss)
                        ) / lossLimit
                    ) * 100,

                leverage: CONFIG.leverage
            };
        }

        /*
         * Inicia un nuevo ciclo con el balance restante.
         * El número de ciclo aumenta.
         */

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
