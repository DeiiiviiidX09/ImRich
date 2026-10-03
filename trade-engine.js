
/*
 * TRADE AI
 * Motor central v3.0
 * Control global de riesgo y reinicio automático.
 * Solo simulación. No ejecuta órdenes reales.
 */

const TradeEngine = (() => {

    const risk = TradeRisk.createManager();

    let engineStatus = "STOPPED";
    let lastSignals = {};
    let decisions = [];
    let autoTimer = null;
    let archivedHistory = [];
let nextRestartAllowedAt = 0;
let cycleEndedThisRun = false;

const RESTART_COOLDOWN_MS = 60000;
    const pairs = [
        "EUR/USD",
        "GBP/USD",
        "USD/JPY"
    ];

    const MAX_POSITIONS = 3;

    // Registrar decisiones
    function logDecision(message) {

        decisions.unshift({
            message,
            time: new Date().toLocaleTimeString()
        });

        if (decisions.length > 150) {
            decisions.pop();
        }
    }

    // Conservar el historial antes de limpiar posiciones
    function archiveHistory() {

        const currentHistory =
            PositionManager.getHistory();

        archivedHistory =
            archivedHistory.concat(
                currentHistory.map(position => ({ ...position }))
            );
    }

    // Calcular el resultado total del ciclo.
    // Incluye posiciones abiertas y cerradas.
    function calculateCyclePL() {

        const closed =
            PositionManager.getHistory();

        const open =
            PositionManager.getOpenPositions();

        const closedPL = closed.reduce(
            (total, position) =>
                total + position.profitLoss,
            0
        );

        const openPL = open.reduce(
            (total, position) =>
                total + position.profitLoss,
            0
        );

        return closedPL + openPL;
    }

    // Cerrar el ciclo y liquidar posiciones restantes

function finishCycle(cycleStatus) {

    if (
        engineStatus === "WAITING" ||
        engineStatus === "RESTART_REQUIRED"
    ) {
        return;
    }

    cycleEndedThisRun = true;

    nextRestartAllowedAt =
        Date.now() + RESTART_COOLDOWN_MS;

    const remaining =
        PositionManager.closeAll(
            cycleStatus === "TAKE_PROFIT"
                ? "CYCLE_TAKE_PROFIT"
                : "CYCLE_LOSS_LIMIT"
        );

    remaining.forEach(position => {

        logDecision(
            position.pair +
            " cerrada por límite global. Resultado: " +
            (position.profitLoss >= 0 ? "+" : "") +
            "$" + position.profitLoss.toFixed(2)
        );

    });

    if (cycleStatus === "TAKE_PROFIT") {

        engineStatus = "WAITING";

        logDecision(
            "Objetivo alcanzado. Todas las posiciones cerradas. " +
            "Pausa de seguridad de 60 segundos."
        );

    } else {

        engineStatus = "RESTART_REQUIRED";

        logDecision(
            "Límite de pérdidas alcanzado. Todas las posiciones cerradas. " +
            "Pausa de seguridad de 60 segundos antes de buscar otro ciclo."
        );
    }
}


    // Actualizar el gestor de riesgo
    function updateRiskControl() {

        if (
            engineStatus !== "RUNNING"
        ) {
            return;
        }

        const totalPL = calculateCyclePL();

        const status =
            risk.updateCycleProfitLoss(totalPL);

        if (status.cycleStatus === "TAKE_PROFIT") {

            finishCycle("TAKE_PROFIT");

        } else if (status.cycleStatus === "LOSS_LIMIT") {

            finishCycle("LOSS_LIMIT");

        }
    }

    // Iniciar el motor
    function start(capital) {

        stopAuto();

        archiveHistory();
        PositionManager.reset();

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

        logDecision("Motor detenido manualmente.");

        return getStatus();
    }

    // Analizar un par y gestionar su posición
    function analyzePair(pair, candles) {

        if (engineStatus !== "RUNNING") {

            return {
                signal: "WAIT",
                reason: "El motor no está activo."
            };
        }

        const result =
            TradeAI.analyze(candles);

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

        if (
            !result.price ||
            !Number.isFinite(result.price)
        ) {
            return result;
        }

        // Actualizar el precio de las posiciones del par
        PositionManager.updatePrice(
            pair,
            result.price
        );

        // Revisar el riesgo después de cada actualización
        updateRiskControl();

        if (engineStatus !== "RUNNING") {
            return result;
        }

        if (
            result.signal !== "BUY" &&
            result.signal !== "SELL"
        ) {
            return result;
        }

        const openPositions =
            PositionManager.getOpenPositions();

        const alreadyOpen =
            openPositions.some(
                position => position.pair === pair
            );

        if (alreadyOpen) {
            return result;
        }

        if (openPositions.length >= MAX_POSITIONS) {
            return result;
        }

        const status = risk.getStatus();

        const available =
            status.currentBalance -
            PositionManager.getTotalMargin();

        const allocation =
            status.currentBalance / MAX_POSITIONS;

        const amount = Math.min(
            allocation,
            available
        );

        if (amount <= 0) {

            logDecision(
                "Capital disponible insuficiente para abrir " +
                pair
            );

            return result;
        }

        const opened =
            PositionManager.openPosition(
                pair,
                result.signal,
                amount,
                result.price
            );

        if (opened.success) {

            logDecision(
                "Posición " + result.signal +
                " abierta en " + pair +
                " con margen de $" +
                amount.toFixed(2)
            );

        } else {

            logDecision(
                "No se pudo abrir " + pair +
                ": " + opened.reason
            );
        }

        return result;
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

        archiveHistory();
        PositionManager.reset();

        risk.resetCycle(status.currentBalance);

        engineStatus = "RUNNING";
        lastSignals = {};

        logDecision(
            "Nuevo ciclo iniciado con $" +
            status.currentBalance.toFixed(2)
        );

        return getStatus();
    }

    // Registrar resultado manual de prueba
    function recordResult(amount) {

        if (engineStatus !== "RUNNING") {
            return getStatus();
        }

        risk.recordTrade(amount);

        const status = risk.getStatus();

        if (status.cycleStatus === "TAKE_PROFIT") {
            finishCycle("TAKE_PROFIT");
        } else if (status.cycleStatus === "LOSS_LIMIT") {
            finishCycle("LOSS_LIMIT");
        }

        return getStatus();
    }

    // Activar análisis automático
    function startAuto(
        candleProvider,
        intervalSeconds = 10
    ) {

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

        let analysisInProgress = false;

        async function runAnalysis() {

            if (analysisInProgress) {
                return;
            }

            analysisInProgress = true;

            try {

                for (const pair of pairs) {

                    let candles;

                    try {

                        candles =
                            await candleProvider(pair);

                    } catch (error) {

                        logDecision(
                            "Error obteniendo datos de " +
                            pair + ": " + error.message
                        );

                        continue;
                    }

                    if (
                        !Array.isArray(candles) ||
                        candles.length === 0
                    ) {

                        logDecision(
                            pair + ": no hay datos disponibles."
                        );

                        continue;
                    }

                    // Si terminó un ciclo, esperar una señal
                    if (
                        engineStatus === "WAITING" ||
                        engineStatus === "RESTART_REQUIRED"
                    ) {

                        const preview =
                            TradeAI.analyze(candles);

                        if (
                            preview.signal === "BUY" ||
                            preview.signal === "SELL"
                        ) {

                            logDecision(
                                "Nueva señal válida detectada en " +
                                pair + ". Preparando reinicio."
                            );

                            restartCycle();

                        } else {

                            continue;
                        }
                    }

                    if (engineStatus === "RUNNING") {

                        analyzePair(pair, candles);

                    }
                }

                if (
                    typeof updateEngineTest === "function"
                ) {
                    updateEngineTest();
                }

            } finally {

                analysisInProgress = false;

            }
        }

        runAnalysis();

        autoTimer = setInterval(
            runAnalysis,
            intervalSeconds * 1000
        );

        return {
            success: true,
            message: "Análisis automático activado."
        };
    }

    // Detener análisis automático
    function stopAuto() {

        if (autoTimer !== null) {

            clearInterval(autoTimer);
            autoTimer = null;

        }
    }

    // Consultar estado completo
    function getStatus() {

        const currentHistory =
            PositionManager.getHistory();

        const fullHistory =
            archivedHistory.concat(currentHistory);

        return {
            engineStatus,
            risk: risk.getStatus(),
            lastSignals,
            decisions,
            autoRunning: autoTimer !== null,
            positions:
                PositionManager.getOpenPositions(),
            history: fullHistory,
            totalMargin:
                PositionManager.getTotalMargin()
        };
    }

    return {
        start,
        stop,
        analyzePair,
        startAuto,
        stopAuto,
        restartCycle,
        recordResult,
        getStatus
    };

})();

window.TradeEngine = TradeEngine;
