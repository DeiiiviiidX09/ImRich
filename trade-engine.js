
/*
 * TRADE AI
 * Motor central v3.0
 * Gestión de riesgo y reinicio automático.
 * Solo simulación.
 */

const TradeEngine = (() => {

    const risk = TradeRisk.createManager();

    let engineStatus = "STOPPED";
    let lastSignals = {};
    let decisions = [];
    let autoTimer = null;
    let analysisRunning = false;

    // Resultado realizado del ciclo actual
    let cycleRealizedPL = 0;

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

    // Iniciar motor
    function start(capital) {

        stopAuto();

        PositionManager.reset();

        cycleRealizedPL = 0;

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

    // Detener motor
    function stop() {

        stopAuto();

        engineStatus = "STOPPED";

        logDecision("Motor detenido.");

        return getStatus();
    }

    // Actualizar el resultado total del ciclo
    function updateCycleRisk() {

        const unrealized =
            PositionManager.getUnrealizedProfitLoss();

        const total =
            cycleRealizedPL + unrealized;

        const status =
            risk.updateCycleProfitLoss(total);

        // Si se alcanzó un límite, cerrar todas las posiciones
        if (
            status.cycleStatus === "TAKE_PROFIT" ||
            status.cycleStatus === "LOSS_LIMIT"
        ) {

            closeCyclePositions(status.cycleStatus);
        }

        return risk.getStatus();
    }

    // Cerrar posiciones al alcanzar un límite global
    function closeCyclePositions(reason) {

        if (
            engineStatus === "WAITING" ||
            engineStatus === "RESTART_REQUIRED"
        ) {
            return;
        }

        stopAuto();

        const closeReason =
            reason === "TAKE_PROFIT"
                ? "CYCLE_TAKE_PROFIT"
                : "CYCLE_LOSS_LIMIT";

        const closed =
            PositionManager.closeAll(closeReason);

        for (const position of closed) {

            cycleRealizedPL += position.profitLoss;

            logDecision(
                position.pair +
                " cerrada por límite global. Resultado: " +
                (position.profitLoss >= 0 ? "+" : "") +
                "$" + position.profitLoss.toFixed(2)
            );
        }

        if (reason === "TAKE_PROFIT") {

            engineStatus = "WAITING";

            logDecision(
                "Objetivo alcanzado. Todas las posiciones cerradas. Esperando nuevas condiciones."
            );

        } else {

            engineStatus = "RESTART_REQUIRED";

            logDecision(
                "Límite de pérdidas alcanzado. Todas las posiciones cerradas. Esperando una nueva señal para reiniciar."
            );
        }
    }

    // Registrar posiciones cerradas individualmente
    function processClosedPositions(closedPositions) {

        for (const position of closedPositions) {

            cycleRealizedPL += position.profitLoss;

            logDecision(
                position.pair + " cerrada. Resultado: " +
                (position.profitLoss >= 0 ? "+" : "") +
                "$" + position.profitLoss.toFixed(2)
            );
        }

        updateCycleRisk();
    }

    // Reiniciar ciclo con el capital restante
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

        // El gestor conserva el historial cerrado
        PositionManager.reset();

        cycleRealizedPL = 0;

        risk.resetCycle(status.currentBalance);

        engineStatus = "RUNNING";
        lastSignals = {};

        logDecision(
            "Nuevo ciclo iniciado con $" +
            status.currentBalance.toFixed(2)
        );

        return getStatus();
    }

    // Analizar un par
    function analyzePair(pair, candles) {

        if (
            engineStatus === "STOPPED" ||
            engineStatus === "ERROR"
        ) {
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

        if (
            !Number.isFinite(result.price) ||
            result.price <= 0
        ) {
            return result;
        }

        // Si el ciclo terminó, esperar una señal válida
        if (
            engineStatus === "WAITING" ||
            engineStatus === "RESTART_REQUIRED"
        ) {

            if (
                result.signal === "BUY" ||
                result.signal === "SELL"
            ) {

                logDecision(
                    "Nueva señal válida detectada. Preparando reinicio del ciclo."
                );

                restartCycle();
            } else {
                return result;
            }
        }

        if (engineStatus !== "RUNNING") {
            return result;
        }

        // Actualizar precios de posiciones abiertas
        const closed = PositionManager.updatePrice(
            pair,
            result.price
        );

        if (closed.length > 0) {
            processClosedPositions(closed);
        } else {
            updateCycleRisk();
        }

        // No abrir operaciones si el ciclo terminó
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

        const alreadyOpen = openPositions.some(
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

        const opened = PositionManager.openPosition(
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

    // Análisis automático
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

        if (
            !Number.isFinite(intervalSeconds) ||
            intervalSeconds < 1
        ) {
            return {
                success: false,
                reason: "Intervalo no válido."
            };
        }

        stopAuto();

        logDecision(
            "Análisis automático activado. Intervalo: " +
            intervalSeconds + " segundos."
        );

        async function runAnalysis() {

            if (analysisRunning) {
                return;
            }

            if (
                engineStatus === "STOPPED" ||
                engineStatus === "ERROR"
            ) {
                stopAuto();
                return;
            }

            analysisRunning = true;

            try {

                for (const pair of pairs) {

                    if (
                        engineStatus === "STOPPED" ||
                        engineStatus === "ERROR"
                    ) {
                        break;
                    }

                    try {

                        const candles =
                            await candleProvider(pair);

                        if (
                            !Array.isArray(candles) ||
                            candles.length === 0
                        ) {

                            logDecision(
                                pair +
                                ": no hay datos disponibles."
                            );

                            continue;
                        }

                        analyzePair(pair, candles);

                    } catch (error) {

                        logDecision(
                            "Error analizando " +
                            pair + ": " + error.message
                        );
                    }
                }

                if (
                    typeof updateEngineTest === "function"
                ) {
                    updateEngineTest();
                }

            } finally {
                analysisRunning = false;
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

    // Consultar estado
    function getStatus() {

        return {
            engineStatus,
            risk: risk.getStatus(),
            lastSignals,
            decisions,
            autoRunning: autoTimer !== null,
            positions: PositionManager.getOpenPositions(),
            history: PositionManager.getHistory(),
            totalMargin: PositionManager.getTotalMargin(),
            unrealizedProfitLoss:
                PositionManager.getUnrealizedProfitLoss()
        };
    }

    return {
        start,
        stop,
        analyzePair,
        startAuto,
        stopAuto,
        restartCycle,
        getStatus
    };

})();

window.TradeEngine = TradeEngine;
