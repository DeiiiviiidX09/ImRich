
/*
 * TRADE AI
 * Motor central v2.1
 * Supervisión global de riesgo.
 * Simulación exclusivamente.
 */

const TradeEngine = (() => {

    const risk = TradeRisk.createManager();

    let engineStatus = "STOPPED";
    let lastSignals = {};
    let decisions = [];
    let autoTimer = null;

    const pairs = [
        "EUR/USD",
        "GBP/USD",
        "USD/JPY"
    ];

    const MAX_POSITIONS = 3;

    // Iniciar el motor
    function start(capital) {

        stopAuto();
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

        logDecision("Motor detenido.");

        return getStatus();
    }

    // Registrar una decisión
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

    // Procesar posiciones cerradas y vigilar el ciclo
    function processClosedPositions(closedPositions = []) {

        if (engineStatus !== "RUNNING") {
            return;
        }

        const status = risk.getStatus();

        const newRealized =
            sumProfitLoss(closedPositions);

        const floating =
            PositionManager.getTotalUnrealizedProfitLoss();

        const projectedProfitLoss =
            status.cycleProfitLoss +
            newRealized +
            floating;

        const targetReached =
            projectedProfitLoss >= status.profitTarget;

        const lossLimitReached =
            projectedProfitLoss <= -status.lossLimit;

        // Si se alcanza un límite global, cerrar todo
        if (targetReached || lossLimitReached) {

            const reason = targetReached
                ? "CYCLE_TAKE_PROFIT"
                : "CYCLE_LOSS_LIMIT";

            const remaining =
                PositionManager.closeAll(reason);

            const allClosed = [
                ...closedPositions,
                ...remaining
            ];

            const finalProfitLoss =
                sumProfitLoss(allClosed);

            // Registrar el resultado total una sola vez
            const finalStatus =
                risk.recordTrade(finalProfitLoss);

            for (const position of allClosed) {

                logDecision(
                    position.pair +
                    " cerrada por límite global. Resultado: " +
                    (position.profitLoss >= 0 ? "+" : "") +
                    "$" + position.profitLoss.toFixed(2)
                );
            }

            stopAuto();

            if (targetReached) {

                engineStatus = "WAITING";

                logDecision(
                    "Objetivo global alcanzado. " +
                    "Todas las posiciones fueron cerradas."
                );

            } else {

                engineStatus = "RESTART_REQUIRED";

                logDecision(
                    "Límite global de pérdidas alcanzado. " +
                    "Todas las posiciones fueron cerradas."
                );
            }

            return finalStatus;
        }

        // Si no se alcanzó ningún límite, registrar
        // únicamente las posiciones que se cerraron
        if (closedPositions.length > 0) {

            const result =
                risk.recordTrade(newRealized);

            for (const position of closedPositions) {

                logDecision(
                    position.pair +
                    " cerrada. Resultado: " +
                    (position.profitLoss >= 0 ? "+" : "") +
                    "$" + position.profitLoss.toFixed(2)
                );
            }

            // Protección adicional por si el gestor
            // detecta un límite con el resultado realizado
            if (result.cycleStatus !== "ACTIVE") {

                engineStatus =
                    result.cycleStatus === "TAKE_PROFIT"
                        ? "WAITING"
                        : "RESTART_REQUIRED";

                stopAuto();

                const remaining =
                    PositionManager.closeAll(
                        "CYCLE_LIMIT"
                    );

                logDecision(
                    "El gestor de riesgo detuvo el ciclo."
                );

                for (const position of remaining) {
                    logDecision(
                        position.pair +
                        " cerrada. Resultado: " +
                        (position.profitLoss >= 0 ? "+" : "") +
                        "$" + position.profitLoss.toFixed(2)
                    );
                }
            }
        }
    }

    // Analizar un par y gestionar su posición
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

        if (
            !result.price ||
            !Number.isFinite(result.price)
        ) {
            return result;
        }

        // Actualizar las posiciones del par
        const closed = PositionManager.updatePrice(
            pair,
            result.price
        );

        // Comprobar límites globales, incluso si
        // ninguna posición se ha cerrado
        processClosedPositions(closed);

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

    // Activar análisis automático
    function startAuto(
        candleProvider,
        intervalSeconds = 30
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

        async function runAnalysis() {

            if (engineStatus !== "RUNNING") {
                stopAuto();
                return;
            }

            for (const pair of pairs) {

                if (engineStatus !== "RUNNING") {
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
                            pair + ": no hay datos disponibles."
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

            if (typeof updateEngineTest === "function") {
                updateEngineTest();
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

    // Consultar estado completo
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
            positions: PositionManager.getOpenPositions(),
            history: PositionManager.getHistory(),
            totalMargin: PositionManager.getTotalMargin()
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
