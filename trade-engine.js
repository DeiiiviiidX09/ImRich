
/*
 * TRADE AI
 * Motor central v1.1
 * Análisis automático y gestión de ciclos.
 * Solo simulación.
 */

const TradeEngine = (() => {

    const risk = TradeRisk.createManager();

    let engineStatus = "STOPPED";
    let lastSignals = {};
    let decisions = [];
    let autoTimer = null;
    let pairs = ["EUR/USD", "GBP/USD", "USD/JPY"];

    // Iniciar el motor
    function start(capital) {

        stopAuto();

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

        stopAuto();

        engineStatus = "STOPPED";

        logDecision("Motor detenido.");

        return getStatus();
    }

    // Analizar un par
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

    // Activar análisis automático

function startAuto(candleProvider, intervalSeconds = 30) {

    if (engineStatus !== "RUNNING") {
        return {
            success: false,
            reason: "Primero debes iniciar el motor."
        };
    }

    if (typeof candleProvider !== "function") {
        return {
            success: false,
            reason: "No se encontró el proveedor de datos."
        };
    }

    stopAuto();

    logDecision(
        "Análisis automático activado. Intervalo: " +
        intervalSeconds + " segundos."
    );

    async function runAnalysis() {

        if (engineStatus !== "RUNNING") {
            stopAuto();
            return;
        }

        logDecision("Iniciando nuevo ciclo de análisis.");

        for (const pair of pairs) {

            if (engineStatus !== "RUNNING") {
                break;
            }

            try {

                const candles = await candleProvider(pair);

                if (!Array.isArray(candles) || candles.length === 0) {

                    logDecision(
                        pair + ": no hay datos disponibles."
                    );

                    continue;
                }

                const result = analyzePair(pair, candles);

                logDecision(
                    "Análisis completado para " + pair +
                    ". Señal: " + result.signal
                );

                if (typeof updateEngineTest === "function") {
                    updateEngineTest();
                }

            } catch (error) {

                logDecision(
                    "ERROR en " + pair + ": " +
                    error.message
                );

                if (typeof escribirLog === "function") {
                    escribirLog(
                        "Error de análisis en " + pair +
                        ": " + error.message
                    );
                }

                if (typeof updateEngineTest === "function") {
                    updateEngineTest();
                }
            }
        }

        logDecision("Ciclo de análisis finalizado.");

        if (typeof updateEngineTest === "function") {
            updateEngineTest();
        }
    }

    // Ejecutar el primer análisis inmediatamente
    runAnalysis();

    // Repetir el análisis automáticamente
    autoTimer = setInterval(
        runAnalysis,
        intervalSeconds * 1000
    );

    return {
        success: true,
        message: "Análisis automático activado."
    };
}


    // Registrar resultado de una operación simulada
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

            stopAuto();
            engineStatus = "WAITING";

            logDecision(
                "Objetivo alcanzado. Análisis detenido."
            );

        } else if (result.cycleStatus === "LOSS_LIMIT") {

            stopAuto();
            engineStatus = "RESTART_REQUIRED";

            logDecision(
                "Límite de pérdidas alcanzado. Análisis detenido."
            );
        }

        return getStatus();
    }

    // Reiniciar ciclo con capital restante
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

            logDecision("Capital insuficiente. Motor detenido.");

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

    // Registrar decisiones
    function logDecision(message) {

        decisions.unshift({
            message,
            time: new Date().toLocaleTimeString()
        });

        if (decisions.length > 100) {
            decisions.pop();
        }
    }

    // Consultar estado
    function getStatus() {

        return {
            engineStatus,
            risk: risk.getStatus(),
            lastSignals,
            decisions,
            autoRunning: autoTimer !== null
        };
    }

    return {
        start,
        stop,
        analyzePair,
        startAuto,
        stopAuto,
        recordResult,
        restartCycle,
        getStatus
    };

})();

window.TradeEngine = TradeEngine;
