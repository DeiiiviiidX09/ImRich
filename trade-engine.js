/*
 * TRADE AI
 * Motor central v1.0
 * Coordina señales y riesgo.
 * Solo simulación.
 */

const TradeEngine = (() => {

    const risk = TradeRisk.createManager();

    let engineStatus = "STOPPED";
    let lastSignals = {};
    let decisions = [];

    // Iniciar el motor con el capital disponible
    function start(capital) {

        risk.startCycle(capital);

        engineStatus = "RUNNING";
        lastSignals = {};
        decisions = [];

        logDecision(
            "Motor iniciado con capital de $" +
            capital.toFixed(2)
        );

        return getStatus();
    }

    // Detener el motor
    function stop() {

        engineStatus = "STOPPED";

        logDecision("Motor detenido.");

        return getStatus();
    }

    // Analizar un par de divisas
    function analyzePair(pair, candles) {

        if (engineStatus !== "RUNNING") {
            return {
                signal: "WAIT",
                reason: "El motor está detenido."
            };
        }

        const result = TradeAI.analyze(candles);

        lastSignals[pair] = {
            signal: result.signal,
            reason: result.reason,
            price: result.price || null,
            time: new Date().toISOString()
        };

        logDecision(
            pair + ": " +
            result.signal + " - " +
            result.reason
        );

        return result;
    }

    // Registrar el resultado de una operación simulada
    function recordResult(profitLoss) {

        if (engineStatus !== "RUNNING") {
            return getStatus();
        }

        const result = risk.recordTrade(profitLoss);

        logDecision(
            "Resultado registrado: " +
            (profitLoss >= 0 ? "+" : "") +
            "$" + profitLoss.toFixed(2)
        );

        if (result.cycleStatus === "TAKE_PROFIT") {

            engineStatus = "WAITING";

            logDecision(
                "Objetivo alcanzado. Se requiere cerrar posiciones y esperar."
            );

        } else if (result.cycleStatus === "LOSS_LIMIT") {

            engineStatus = "RESTART_REQUIRED";

            logDecision(
                "Límite de pérdidas alcanzado. Se requiere cerrar posiciones y preparar un nuevo ciclo."
            );
        }

        return getStatus();
    }

    // Reiniciar el ciclo con el capital restante
    function restartCycle() {

        const status = risk.getStatus();

        if (
            engineStatus !== "WAITING" &&
            engineStatus !== "RESTART_REQUIRED"
        ) {
            return getStatus();
        }

        if (status.currentBalance <= 0) {

            engineStatus = "STOPPED";

            logDecision(
                "Capital insuficiente. Motor detenido."
            );

            return getStatus();
        }

        risk.resetCycle(status.currentBalance);

        engineStatus = "RUNNING";
        lastSignals = {};

        logDecision(
            "Nuevo ciclo iniciado con $" +
            status.currentBalance.toFixed(2)
        );

        return getStatus();
    }

    // Guardar una decisión en el registro
    function logDecision(message) {

        decisions.unshift({
            message,
            time: new Date().toLocaleTimeString()
        });

        if (decisions.length > 100) {
            decisions.pop();
        }
    }

    // Consultar estado completo
    function getStatus() {

        return {
            engineStatus,
            risk: risk.getStatus(),
            lastSignals,
            decisions
        };
    }

    return {
        start,
        stop,
        analyzePair,
        recordResult,
        restartCycle,
        getStatus
    };

})();

window.TradeEngine = TradeEngine;
