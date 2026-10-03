
/*
 * TRADE AI
 * Gestor de riesgo v1.0
 * Solo simulación.
 * No ejecuta operaciones reales.
 */

const TradeRisk = (() => {

    const CONFIG = {
        profitTarget: 0.03,
        maxLoss: 0.01,
        leverage: 10
    };

    let cycleStartBalance = 100;
    let cycleProfitLoss = 0;
    let cycleNumber = 1;
    let cycleStatus = "ACTIVE";

    // Iniciar un ciclo con el capital disponible
    function startCycle(balance) {

        if (!Number.isFinite(balance) || balance <= 0) {
            throw new Error("El capital debe ser mayor que cero.");
        }

        cycleStartBalance = balance;
        cycleProfitLoss = 0;
        cycleStatus = "ACTIVE";

        return getStatus();
    }

    // Registrar el resultado de una operación cerrada
    function recordTrade(profitLoss) {

        if (cycleStatus !== "ACTIVE") {
            return getStatus();
        }

        if (!Number.isFinite(profitLoss)) {
            throw new Error("Resultado de operación no válido.");
        }

        cycleProfitLoss += profitLoss;

        const profitTarget =
            cycleStartBalance * CONFIG.profitTarget;

        const lossLimit =
            cycleStartBalance * CONFIG.maxLoss;

        if (cycleProfitLoss >= profitTarget) {

            cycleStatus = "TAKE_PROFIT";

        } else if (cycleProfitLoss <= -lossLimit) {

            cycleStatus = "LOSS_LIMIT";

        }

        return getStatus();
    }

    // Consultar el estado actual del ciclo
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

    // Comenzar un nuevo ciclo con el capital restante
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

})();

// Hacer el gestor accesible desde toda la aplicación
window.TradeRisk = TradeRisk;
