
const TradeEngine = (() => {
    "use strict";

    const CONFIG = {
        pairs: ["EUR/USD", "GBP/USD", "USD/JPY"],
        maxOpenPositions: 3,
        leverage: 10,
        intervalSeconds: 10,
        cooldownSeconds: 60,
        maxMarginPerPosition: 0.33
    };

    let risk = null;
    let engineStatus = "STOPPED";
    let autoTimer = null;
    let candleProvider = null;
    let intervalSeconds = CONFIG.intervalSeconds;

    let lastSignals = {};
    let decisionLog = [];
    let archivedHistory = [];
    let cycleEndedThisRun = false;
    let lastCycleEndTime = null;
    let lastError = null;

    function logDecision(message, type = "INFO") {
        const entry = {
            time: new Date().toISOString(),
            message,
            type
        };

        decisionLog.unshift(entry);

        if (decisionLog.length > 100) {
            decisionLog = decisionLog.slice(0, 100);
        }

        console.log("[Trade AI]", message);
    }

    function getCurrentBalance() {
        if (!risk) return 0;

        const status = risk.getStatus();

        return Number(status.currentBalance) || 0;
    }

    function getCycleProfitLoss() {
        const status = risk ? risk.getStatus() : {};

        return Number(status.cycleProfitLoss) || 0;
    }

    function calculateCyclePL() {
        const history = PositionManager.getHistory() || [];
        const openPositions = PositionManager.getOpenPositions() || [];

        const closedPL = history.reduce((total, position) => {
            return total + (Number(position.profitLoss) || 0);
        }, 0);

        const openPL = openPositions.reduce((total, position) => {
            return total + (Number(position.profitLoss) || 0);
        }, 0);

        return closedPL + openPL;
    }

    function updateRiskControl() {
        if (!risk) return;

        const totalPL = calculateCyclePL();

        if (typeof risk.updateCycleProfitLoss === "function") {
            risk.updateCycleProfitLoss(totalPL);
        } else if (typeof risk.recordTrade === "function") {
            const previousPL = getCycleProfitLoss();
            const difference = totalPL - previousPL;

            if (difference !== 0) {
                risk.recordTrade(difference);
            }
        }

        const status = risk.getStatus();

        if (
            status.status === "TAKE_PROFIT" ||
            status.status === "LOSS_LIMIT"
        ) {
            finishCycle(status.status);
        }
    }

    function archiveHistory() {
        const history = PositionManager.getHistory() || [];

        archivedHistory = archivedHistory.concat(history);
    }

    function finishCycle(reason) {
        if (cycleEndedThisRun) return;

        cycleEndedThisRun = true;

        stopAuto();

        const message = reason === "TAKE_PROFIT"
            ? "Objetivo de beneficio alcanzado."
            : "Límite de pérdida alcanzado.";

        logDecision(message);

        PositionManager.closeAll();

        const finalPL = calculateCyclePL();

        if (risk && typeof risk.updateCycleProfitLoss === "function") {
            risk.updateCycleProfitLoss(finalPL);
        }

        engineStatus = "WAITING";
        lastCycleEndTime = Date.now();

        logDecision(
            "Todas las posiciones han sido cerradas. El motor esperará nuevas condiciones."
        );
    }

    function analyzePair(pair, candles) {
        if (engineStatus !== "RUNNING") return null;

        if (!Array.isArray(candles) || candles.length < 51) {
            logDecision(
                "Datos insuficientes para analizar " + pair,
                "WARNING"
            );
            return null;
        }

        const analysis = TradeAI.analyze(candles);

        if (!analysis || !analysis.signal) {
            logDecision(
                "No se recibió una señal válida para " + pair,
                "WARNING"
            );
            return null;
        }

        lastSignals[pair] = {
            signal: analysis.signal,
            reason: analysis.reason || "",
            price: analysis.price,
            time: new Date().toISOString()
        };

        logDecision(
            pair + ": " + analysis.signal + " | " +
            (analysis.reason || "Análisis completado")
        );

        const price = Number(
            analysis.price ||
            candles[candles.length - 1].close
        );

        if (!Number.isFinite(price) || price <= 0) {
            logDecision("Precio inválido para " + pair, "ERROR");
            return analysis;
        }

        PositionManager.updatePrice(pair, price);

        updateRiskControl();

        if (engineStatus !== "RUNNING") {
            return analysis;
        }

        const openPositions = PositionManager.getOpenPositions() || [];

        const alreadyOpen = openPositions.some(position => {
            return position.pair === pair;
        });

        if (
            analysis.signal !== "BUY" &&
            analysis.signal !== "SELL"
        ) {
            return analysis;
        }

        if (alreadyOpen) {
            logDecision(
                "Ya existe una posición abierta en " + pair
            );
            return analysis;
        }

        if (
            PositionManager.countOpenPositions() >=
            CONFIG.maxOpenPositions
        ) {
            logDecision("Se alcanzó el máximo de posiciones abiertas.");
            return analysis;
        }

        const balance = getCurrentBalance();

        if (balance <= 0) {
            logDecision("No hay capital disponible.", "WARNING");
            stop();
            return analysis;
        }

        const margin = balance * CONFIG.maxMarginPerPosition;

        const result = PositionManager.openPosition(
            pair,
            analysis.signal,
            margin,
            price
        );

        if (result && result.success) {
            logDecision(
                "Posición " + analysis.signal +
                " abierta en " + pair +
                " con margen de $" + margin.toFixed(2)
            );
        } else {
            logDecision(
                "No se pudo abrir posición en " + pair +
                ": " + ((result && result.reason) || "Error desconocido"),
                "WARNING"
            );
        }

        return analysis;
    }

    function runAnalysis() {
        if (
            engineStatus !== "RUNNING" &&
            engineStatus !== "WAITING"
        ) {
            return;
        }

        cycleEndedThisRun = false;

        try {
            if (engineStatus === "WAITING") {
                const elapsed = lastCycleEndTime
                    ? (Date.now() - lastCycleEndTime) / 1000
                    : CONFIG.cooldownSeconds;

                if (elapsed < CONFIG.cooldownSeconds) {
                    return;
                }

                let validSignalFound = false;

                for (const pair of CONFIG.pairs) {
                    const candles = candleProvider(pair);

                    if (!Array.isArray(candles)) continue;

                    const preview = TradeAI.analyze(candles);

                    if (
                        preview &&
                        (preview.signal === "BUY" ||
                         preview.signal === "SELL")
                    ) {
                        validSignalFound = true;
                        break;
                    }
                }

                if (!validSignalFound) {
                    logDecision(
                        "Esperando una señal adecuada para iniciar el siguiente ciclo."
                    );
                    return;
                }

                const currentBalance = getCurrentBalance();

                if (currentBalance <= 0) {
                    logDecision(
                        "El capital restante es insuficiente. Motor detenido.",
                        "WARNING"
                    );
                    stop();
                    return;
                }

                archiveHistory();
                PositionManager.reset();
                risk.resetCycle(currentBalance);

                engineStatus = "RUNNING";

                logDecision(
                    "Nuevo ciclo iniciado con $" +
                    currentBalance.toFixed(2)
                );
            }

            for (const pair of CONFIG.pairs) {
                if (engineStatus !== "RUNNING") break;

                const candles = candleProvider(pair);

                if (!Array.isArray(candles)) {
                    logDecision(
                        "No se recibieron datos para " + pair,
                        "WARNING"
                    );
                    continue;
                }

                analyzePair(pair, candles);

                if (cycleEndedThisRun) {
                    break;
                }
            }
        } catch (error) {
            lastError = error.message || String(error);

            logDecision(
                "Error durante el análisis: " + lastError,
                "ERROR"
            );

            console.error(error);
        }
    }

    function start(capital) {
        const amount = Number(capital);

        if (!Number.isFinite(amount) || amount <= 0) {
            return {
                success: false,
                reason: "El capital inicial debe ser mayor que cero."
            };
        }

        stopAuto();

        try {
            risk = TradeRisk.createManager();

            PositionManager.reset();

            risk.startCycle(amount);

            engineStatus = "RUNNING";
            lastSignals = {};
            lastError = null;
            cycleEndedThisRun = false;
            lastCycleEndTime = null;

            logDecision(
                "Motor iniciado con un capital de $" +
                amount.toFixed(2)
            );

            return {
                success: true,
                status: getStatus()
            };
        } catch (error) {
            engineStatus = "STOPPED";

            logDecision(
                "No se pudo iniciar el motor: " + error.message,
                "ERROR"
            );

            return {
                success: false,
                reason: error.message
            };
        }
    }

    function stop() {
        stopAuto();

        if (engineStatus !== "STOPPED") {
            engineStatus = "STOPPED";
            logDecision("Motor detenido manualmente.");
        }

        return getStatus();
    }

    function startAuto(provider, seconds = CONFIG.intervalSeconds) {
        if (engineStatus !== "RUNNING") {
            return {
                success: false,
                reason: "Primero debes iniciar el motor."
            };
        }

        if (typeof provider !== "function") {
            return {
                success: false,
                reason: "No se encontró el proveedor de datos."
            };
        }

        stopAuto();

        candleProvider = provider;

        intervalSeconds = Math.max(
            1,
            Number(seconds) || CONFIG.intervalSeconds
        );

        autoTimer = setInterval(
            runAnalysis,
            intervalSeconds * 1000
        );

        logDecision(
            "Análisis automático activado cada " +
            intervalSeconds + " segundos."
        );

        runAnalysis();

        return {
            success: true,
            intervalSeconds
        };
    }

    function stopAuto() {
        if (autoTimer !== null) {
            clearInterval(autoTimer);
            autoTimer = null;
        }
    }

    function restartCycle() {
        if (!risk) {
            return {
                success: false,
                reason: "El motor todavía no ha sido iniciado."
            };
        }

        const status = risk.getStatus();

        if (status.currentBalance <= 0) {
            engineStatus = "STOPPED";

            logDecision(
                "Capital insuficiente. Motor detenido.",
                "WARNING"
            );

            return getStatus();
        }

        archiveHistory();
        PositionManager.reset();

        risk.resetCycle(status.currentBalance);

        engineStatus = "RUNNING";
        lastSignals = {};
        cycleEndedThisRun = false;
        lastCycleEndTime = null;

        logDecision(
            "Nuevo ciclo iniciado manualmente con $" +
            status.currentBalance.toFixed(2)
        );

        return getStatus();
    }

    function getStatus() {
        const riskStatus = risk
            ? risk.getStatus()
            : null;

        return {
            engineStatus,
            isRunning: engineStatus === "RUNNING",
            isWaiting: engineStatus === "WAITING",
            isStopped: engineStatus === "STOPPED",
            balance: getCurrentBalance(),
            cycleProfitLoss: getCycleProfitLoss(),
            risk: riskStatus,
            openPositions: PositionManager.getOpenPositions(),
            positionHistory: PositionManager.getHistory(),
            archivedHistory,
            lastSignals,
            decisionLog,
            lastError,
            autoActive: autoTimer !== null,
            intervalSeconds
        };
    }

    return {
        start,
        stop,
        analyzePair,
        startAuto,
        stopAuto,
        restartCycle,
        getStatus,
        runAnalysis
    };
})();
