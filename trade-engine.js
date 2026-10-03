
const TradeEngine = (() => {
    let risk = null;
    let engineStatus = "STOPPED";
    let autoTimer = null;
    let autoProvider = null;
    let intervalSeconds = 10;
    let cyclePositionIds = new Set();
    let manualPL = 0;
    let lifetimeManualWins = 0;

let lifetimeManualLosses = 0;
    let lastSignals = {};
    let decisionLog = [];
    let lastError = null;
    let lastCycleEndTime = 0;
    let cooldownMs = 30000;

    const MAX_POSITIONS = 3;
    const POSITION_FRACTION = 0.33;

    function log(message, type = "info") {
        const entry = {
            message,
            type,
            timestamp: new Date().toISOString()
        };

        decisionLog.unshift(entry);

        if (decisionLog.length > 100) {
            decisionLog.length = 100;
        }

        console.log(`[TradeEngine] ${message}`);
    }

    function getCurrentCyclePositions() {
        return PositionManager.getOpenPositions().filter(
            position => cyclePositionIds.has(position.id)
        );
    }

    function getCurrentCycleHistory() {
        return PositionManager.getHistory().filter(
            position => cyclePositionIds.has(position.id)
        );
    }

    function calculateCyclePL() {
        const openPL = getCurrentCyclePositions().reduce(
            (total, position) => total + Number(position.profitLoss || 0),
            0
        );

        const closedPL = getCurrentCycleHistory().reduce(
            (total, position) => total + Number(position.profitLoss || 0),
            0
        );

        return openPL + closedPL + manualPL;
    }
function calculateAllTimeStats() {
    const closed = PositionManager.getHistory();
    const open = PositionManager.getOpenPositions();

    const allPositions = [...closed, ...open];

    const positionWins = allPositions.reduce(
        (total, position) =>
            total + Math.max(0, Number(position.profitLoss || 0)),
        0
    );

    const positionLosses = allPositions.reduce(
        (total, position) =>
            total + Math.abs(Math.min(0, Number(position.profitLoss || 0))),
        0
    );

    const totalWins = positionWins + lifetimeManualWins;
    const totalLosses = positionLosses + lifetimeManualLosses;

    return {
        totalWins,
        totalLosses,
        netProfitLoss: totalWins - totalLosses,
        closedTrades: closed.length,
        openTrades: open.length
    };
}
    function getRiskStatus() {
        return risk ? risk.getStatus() : null;
    }

    function stopAuto() {
        if (autoTimer !== null) {
            clearInterval(autoTimer);
            autoTimer = null;
        }
    }

    function finishCycle(reason) {
        if (!risk) return;

        const openPositions = getCurrentCyclePositions();

        if (openPositions.length > 0) {
            PositionManager.closeAll(reason);
        }

        const finalPL = calculateCyclePL();
        risk.updateCycleProfitLoss(finalPL);

        engineStatus = "WAITING";
        lastCycleEndTime = Date.now();

        log(
            `Ciclo finalizado: ${reason}. Resultado: ${finalPL.toFixed(2)}`,
            "warning"
        );
    }

    function checkRiskLimits() {
        if (!risk || engineStatus !== "RUNNING") return;

        const totalPL = calculateCyclePL();
        risk.updateCycleProfitLoss(totalPL);

        const status = risk.getStatus();

        if (status.cycleStatus === "TAKE_PROFIT") {
            finishCycle("TAKE_PROFIT");
        } else if (status.cycleStatus === "LOSS_LIMIT") {
            finishCycle("LOSS_LIMIT");
        }
    }

    function beginNewCycle() {
        if (!risk) {
            return {
                success: false,
                reason: "El motor todavía no está inicializado."
            };
        }

        const status = risk.getStatus();
        const remainingBalance = Number(status.currentBalance);

        if (!Number.isFinite(remainingBalance) || remainingBalance <= 0) {
            return {
                success: false,
                reason: "No queda capital disponible para iniciar otro ciclo."
            };
        }

        PositionManager.reset(false);
        cyclePositionIds.clear();
        manualPL = 0;

        risk.resetCycle(remainingBalance);

        engineStatus = "RUNNING";
        lastCycleEndTime = 0;

        log(
            `Nuevo ciclo iniciado con ${remainingBalance.toFixed(2)} de capital.`,
            "success"
        );

        return {
            success: true,
            balance: remainingBalance
        };
    }

    function start(capital) {
        const amount = Number(capital);

        if (!Number.isFinite(amount) || amount <= 0) {
            return {
                success: false,
                reason: "Introduce un capital inicial válido."
            };
        }

        stopAuto();

        risk = TradeRisk.createManager();
        risk.startCycle(amount);

        PositionManager.reset(false);
        cyclePositionIds.clear();

        manualPL = 0;
        lastSignals = {};
        lastError = null;

        engineStatus = "RUNNING";
        lastCycleEndTime = 0;

        log(`Motor iniciado con ${amount.toFixed(2)} de capital.`, "success");

        return {
            success: true,
            balance: amount
        };
    }

    function stop() {
        stopAuto();

        if (engineStatus !== "STOPPED") {
            engineStatus = "STOPPED";
            log("Motor detenido por el usuario.", "warning");
        }

        return {
            success: true,
            status: engineStatus
        };
    }

    function analyzePair(pair, candles) {
        if (!risk) {
            return {
                success: false,
                reason: "Primero debes iniciar el motor."
            };
        }

        if (engineStatus !== "RUNNING") {
            return {
                success: false,
                reason: "El motor no está en estado activo."
            };
        }

        try {
            const analysis = TradeAI.analyze(candles);

            lastSignals[pair] = {
                ...analysis,
                timestamp: new Date().toISOString()
            };

            if (!Number.isFinite(Number(analysis.price))) {
                throw new Error("El análisis no devolvió un precio válido.");
            }

            const closedPositions = PositionManager.updatePrice(
                pair,
                Number(analysis.price)
            );

            closedPositions.forEach(position => {
                log(
                    `${pair}: posición cerrada con resultado ${Number(position.profitLoss).toFixed(2)}.`,
                    "info"
                );
            });

            checkRiskLimits();

            if (engineStatus !== "RUNNING") {
                return {
                    success: true,
                    analysis,
                    opened: false,
                    reason: "Se alcanzó un límite del ciclo."
                };
            }

            if (analysis.signal !== "BUY" && analysis.signal !== "SELL") {
                log(`${pair}: sin señal de entrada.`, "info");

                return {
                    success: true,
                    analysis,
                    opened: false,
                    reason: "No hay señal de entrada."
                };
            }

            const alreadyOpen = getCurrentCyclePositions().some(
                position => position.pair === pair
            );

            if (alreadyOpen) {
                return {
                    success: true,
                    analysis,
                    opened: false,
                    reason: "Ya existe una posición abierta en este par."
                };
            }

            if (getCurrentCyclePositions().length >= MAX_POSITIONS) {
                return {
                    success: true,
                    analysis,
                    opened: false,
                    reason: "Se alcanzó el máximo de posiciones abiertas."
                };
            }

            const balance = Number(risk.getStatus().currentBalance);
            const reservedMargin = PositionManager.getTotalMargin();
            const availableMargin = Math.max(0, balance - reservedMargin);

            const margin = Math.min(
                balance * POSITION_FRACTION,
                availableMargin
            );

            if (margin <= 0) {
                return {
                    success: true,
                    analysis,
                    opened: false,
                    reason: "No hay margen disponible."
                };
            }

            const result = PositionManager.openPosition(
                pair,
                analysis.signal,
                margin,
                Number(analysis.price)
            );

            if (!result.success) {
                return {
                    success: true,
                    analysis,
                    opened: false,
                    reason: result.reason
                };
            }

            cyclePositionIds.add(result.position.id);

            log(
                `Nueva posición ${analysis.signal} en ${pair}. Margen: ${margin.toFixed(2)}.`,
                "success"
            );

            checkRiskLimits();

            return {
                success: true,
                analysis,
                opened: true,
                position: result.position
            };
        } catch (error) {
            lastError = error.message;
            log(`Error analizando ${pair}: ${error.message}`, "error");

            return {
                success: false,
                reason: error.message
            };
        }
    }

    function runAnalysis() {
        if (!autoProvider || !risk) return;

        if (engineStatus === "WAITING") {
            const elapsed = Date.now() - lastCycleEndTime;

            if (elapsed < cooldownMs) return;

            let foundSignal = false;

            try {
                const pairs = ["EUR/USD", "GBP/USD", "USD/JPY"];

                for (const pair of pairs) {
                    const candles = autoProvider(pair);
                    const analysis = TradeAI.analyze(candles);

                    if (analysis.signal === "BUY" || analysis.signal === "SELL") {
                        foundSignal = true;
                        break;
                    }
                }
            } catch (error) {
                lastError = error.message;
                log(`Error buscando nuevas condiciones: ${error.message}`, "error");
                return;
            }

            if (!foundSignal) {
                log("Esperando condiciones adecuadas para reiniciar.", "info");
                return;
            }

            const result = beginNewCycle();

            if (!result.success) {
                log(result.reason, "error");
                return;
            }
        }

        if (engineStatus !== "RUNNING") return;

        const pairs = ["EUR/USD", "GBP/USD", "USD/JPY"];

        for (const pair of pairs) {
            if (engineStatus !== "RUNNING") break;

            try {
                const candles = autoProvider(pair);
                analyzePair(pair, candles);
            } catch (error) {
                lastError = error.message;
                log(`Error en el ciclo automático: ${error.message}`, "error");
            }
        }
    }

    function startAuto(provider, seconds = 10) {
        if (!risk) {
            return {
                success: false,
                reason: "Primero debes iniciar el motor."
            };
        }

        if (typeof provider !== "function") {
            return {
                success: false,
                reason: "No se ha proporcionado una fuente de datos válida."
            };
        }

        stopAuto();

        autoProvider = provider;
        intervalSeconds = Math.max(1, Number(seconds) || 10);

        runAnalysis();

        autoTimer = setInterval(
            runAnalysis,
            intervalSeconds * 1000
        );

        log(
            `Análisis automático activado cada ${intervalSeconds} segundos.`,
            "success"
        );

        return {
            success: true,
            intervalSeconds
        };
    }

    function recordResult(amount) {
        if (!risk) {
            return {
                success: false,
                reason: "Primero debes iniciar el motor."
            };
        }

        const value = Number(amount);

        if (!Number.isFinite(value)) {
            return {
                success: false,
                reason: "El resultado debe ser un número válido."
            };
        }

        if (engineStatus !== "RUNNING") {
            return {
                success: false,
                reason: "No se pueden registrar resultados fuera de un ciclo activo."
            };
        }

        manualPL += value;
if (value >= 0) {
    lifetimeManualWins += value;
} else {
    lifetimeManualLosses += Math.abs(value);
}
        log(
            `Resultado simulado registrado: ${value.toFixed(2)}.`,
            "info"
        );

        checkRiskLimits();

        return {
            success: true,
            cycleProfitLoss: calculateCyclePL()
        };
    }

    function restartCycle() {
        if (engineStatus !== "WAITING") {
            return {
                success: false,
                reason: "El motor no está esperando un nuevo ciclo."
            };
        }

        return beginNewCycle();
    }

    function getStatus() {
        const openPositions = getCurrentCyclePositions();
        const positionHistory = getCurrentCycleHistory();
        const riskStatus = getRiskStatus();
const allTimeStats = calculateAllTimeStats();
        return {
            engineStatus,
            isRunning: engineStatus === "RUNNING",
            isWaiting: engineStatus === "WAITING",
            isStopped: engineStatus === "STOPPED",

            balance: riskStatus ? riskStatus.currentBalance : 0,
            currentBalance: riskStatus ? riskStatus.currentBalance : 0,
            cycleProfitLoss: calculateCyclePL(),

            risk: riskStatus,

            openPositions,
            positions: openPositions,

            positionHistory,
            history: positionHistory,
            allHistory: PositionManager.getHistory(),
allTimeStats,
            lastSignals,
            decisionLog,
            decisions: decisionLog,

            lastError,
            autoActive: autoTimer !== null,
            intervalSeconds
        };
    }

    return {
        start,
        stop,
        startAuto,
        stopAuto,
        analyzePair,
        recordResult,
        restartCycle,
        getStatus
    };
})();

window.TradeEngine = TradeEngine;
