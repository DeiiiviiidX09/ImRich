
/*
 * TRADE AI
 * Motor central v2.2
 * Supervisión global y reinicio automático.
 * Simulación exclusivamente.
 */

const TradeEngine = (() => {

    const risk = TradeRisk.createManager();

    let engineStatus = "STOPPED";
    let lastSignals = {};
    let decisions = [];
    let autoTimer = null;
    let analysisRunning = false;

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

        if (decisions.length > 100) {
            decisions.pop();
        }
    }

    // Sumar resultados de varias posiciones
    function sumProfitLoss(positions) {

        return positions.reduce(
            (total, position) =>
                total + position.profitLoss,
            0
        );
    }

    // Iniciar el motor
    function start(capital) {

        stopAuto();

        PositionManager.reset();
        risk.startCycle(capital);

        engineStatus = "RUNNING";
        lastSignals = {};
        decisions = [];
        analysisRunning = false;

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

    // Comprobar si el motor puede analizar
    function canAnalyze() {

        return (
            engineStatus === "RUNNING" ||
            engineStatus === "WAITING" ||
            engineStatus === "RESTART_REQUIRED"
        );
    }

    // Cerrar posiciones y registrar resultados
    function closeCycle(closedPositions, reason) {

        const remaining =
            PositionManager.closeAll(reason);

        const allClosed = [
            ...closedPositions,
            ...remaining
        ];

        const finalProfitLoss =
            sumProfitLoss(allClosed);

        // Registrar todos los resultados una sola vez
        const finalStatus =
            risk.recordTrade(finalProfitLoss);

        for (const position of allClosed) {

            logDecision(
                position.pair +
                " cerrada. Resultado: " +
                (position.profitLoss >= 0 ? "+" : "") +
                "$" + position.profitLoss.toFixed(2)
            );
        }

        if (reason === "CYCLE_TAKE_PROFIT") {

            engineStatus = "WAITING";

            logDecision(
                "Objetivo del ciclo alcanzado. " +
                "Todas las posiciones cerradas. " +
                "Esperando nuevas condiciones."
            );

        } else {

            engineStatus = "RESTART_REQUIRED";

            logDecision(
                "Límite global de pérdidas alcanzado. " +
                "Todas las posiciones cerradas. " +
                "Esperando nuevas condiciones."
            );
        }

        return finalStatus;
    }

    // Supervisar el resultado total del ciclo
    function processClosedPositions(closedPositions = []) {

        if (engineStatus !== "RUNNING") {
            return;
        }

        const status = risk.getStatus();

        const newlyRealized =
            sumProfitLoss(closedPositions);

        const floating =
            PositionManager.getTotalUnrealizedProfitLoss();

        const projectedProfitLoss =
            status.cycleProfitLoss +
            newlyRealized +
            floating;

        const targetReached =
            projectedProfitLoss >= status.profitTarget;

        const lossLimitReached =
            projectedProfitLoss <= -status.lossLimit;

        // Comprobar límites globales antes de continuar
        if (targetReached || lossLimitReached) {

            const reason = targetReached
                ? "CYCLE_TAKE_PROFIT"
                : "CYCLE_LOSS_LIMIT";

            closeCycle(closedPositions, reason);

            return;
        }

        // Si no se alcanzó ningún límite,
        // registrar las operaciones que se cerraron
        if (closedPositions.length > 0) {

            risk.recordTrade(newlyRealized);

            for (const position of closedPositions) {

                logDecision(
                    position.pair +
                    " cerrada. Resultado: " +
                    (position.profitLoss >= 0 ? "+" : "") +
                    "$" + position.profitLoss.toFixed(2)
                );
            }
        }
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

        if (
            !Number.isFinite(status.currentBalance) ||
            status.currentBalance <= 0
        ) {

            engineStatus = "STOPPED";

            stopAuto();

            logDecision(
                "Capital insuficiente. Motor detenido."
            );

            return getStatus();
        }

        PositionManager.reset();

        risk.resetCycle(status.currentBalance);

        engineStatus = "RUNNING";
        lastSignals = {};

        logDecision(
            "Nuevo ciclo iniciado automáticamente con $" +
            status.currentBalance.toFixed(2)
        );

        return getStatus();
    }

    // Analizar un par y gestionar sus posiciones
    function analyzePair(pair, candles) {

        if (!canAnalyze()) {

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

        // Si el ciclo está esperando, no abrir posiciones
        // hasta recibir una señal válida
        if (
            engineStatus === "WAITING" ||
            engineStatus === "RESTART_REQUIRED"
        ) {

            if (
                result.signal !== "BUY" &&
                result.signal !== "SELL"
            ) {
                return result;
            }

            logDecision(
                "Nueva señal válida detectada. " +
                "Preparando reinicio del ciclo."
            );

            restartCycle();
        }

        if (engineStatus !== "RUNNING") {
            return result;
        }

        // Actualizar posiciones abiertas
        const closed = PositionManager.updatePrice(
            pair,
            result.price
        );

        // Comprobar beneficio y pérdida global
        processClosedPositions(closed);

        if (engineStatus !== "RUNNING") {
            return result;
        }

        // Solo abrir posiciones con señal válida
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

    // Activar análisis automático
    function startAuto(
        candleProvider,
        intervalSeconds = 30
    ) {

        if (!canAnalyze()) {

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

            if (!canAnalyze()) {
                stopAuto();
                return;
            }

            // Evitar que se solapen dos ciclos de análisis
            if (analysisRunning) {
                return;
            }

            analysisRunning = true;

            try {

                for (const pair of pairs) {

                    if (!canAnalyze()) {
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
                            "Error analizando " + pair +
                            ": " + error.message
                        );
                    }
                }

            } finally {

                analysisRunning = false;

                if (
                    typeof updateEngineTest === "function"
                ) {
                    updateEngineTest();
                }
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

    // Registrar un resultado para pruebas manuales
    function recordResult(profitLoss) {

        if (engineStatus !== "RUNNING") {
            return getStatus();
        }

        if (!Number.isFinite(profitLoss)) {
            throw new Error("Resultado no válido.");
        }

        const result = risk.recordTrade(profitLoss);

        logDecision(
            "Resultado manual de prueba: " +
            (profitLoss >= 0 ? "+" : "") +
            "$" + profitLoss.toFixed(2)
        );

        if (result.cycleStatus === "TAKE_PROFIT") {

            closeCycle([], "CYCLE_TAKE_PROFIT");

        } else if (result.cycleStatus === "LOSS_LIMIT") {

            closeCycle([], "CYCLE_LOSS_LIMIT");
        }

        return getStatus();
    }

    // Estado completo del motor
    function getStatus() {

        const riskStatus = risk.getStatus();

        const floating =
            PositionManager.getTotalUnrealizedProfitLoss();

        return {
            engineStatus,

            risk: {
                ...riskStatus,

                floatingProfitLoss: floating,

                projectedCycleProfitLoss:
                    riskStatus.cycleProfitLoss + floating
            },

            lastSignals,
            decisions,

            autoRunning: autoTimer !== null,

            positions:
                PositionManager.getOpenPositions(),

            history:
                PositionManager.getHistory(),

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
