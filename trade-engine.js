
/*
 * TRADE AI
 * Motor autónomo v5.0
 *
 * Simulación exclusivamente.
 * No ejecuta órdenes reales ni se conecta a un broker.
 *
 * Configuración:
 * - Capital inicial: $100
 * - Apalancamiento: 1:30
 * - Objetivo neto por ciclo: +$0.20
 * - Pérdida máxima por ciclo: -$5.00
 */

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

    const MAX_POSITIONS = 1;
    const POSITION_FRACTION = 1.00;

    const CONFIG = {
        startingCapital: 100,
        leverage: 30,
        profitTarget: 0.20,
        maxLoss: 5.00
    };

    // --------------------------------------------------
    // REGISTRO DE DECISIONES
    // --------------------------------------------------

    function log(message, type = "info") {

        const entry = {
            message,
            type,
            timestamp: new Date().toISOString()
        };

        decisionLog.unshift(entry);

        if (decisionLog.length > 150) {
            decisionLog.length = 150;
        }

        console.log(`[TradeEngine] ${message}`);
    }

    // --------------------------------------------------
    // POSICIONES DEL CICLO ACTUAL
    // --------------------------------------------------

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

    // --------------------------------------------------
    // RESULTADOS DEL CICLO
    // --------------------------------------------------

    function calculateCyclePL() {

        const openPL = getCurrentCyclePositions().reduce(
            (total, position) =>
                total + Number(position.profitLoss || 0),
            0
        );

        const closedPL = getCurrentCycleHistory().reduce(
            (total, position) =>
                total + Number(position.profitLoss || 0),
            0
        );

        return openPL + closedPL + manualPL;
    }

    function calculateAllTimeStats() {

        const closed = PositionManager.getHistory();
        const open = PositionManager.getOpenPositions();

        const positionWins = closed.reduce(
            (total, position) =>
                total + Math.max(
                    0,
                    Number(position.profitLoss || 0)
                ),
            0
        );

        const positionLosses = closed.reduce(
            (total, position) =>
                total + Math.abs(
                    Math.min(
                        0,
                        Number(position.profitLoss || 0)
                    )
                ),
            0
        );

        const totalWins =
            positionWins + lifetimeManualWins;

        const totalLosses =
            positionLosses + lifetimeManualLosses;

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

    // --------------------------------------------------
    // CONTROL DEL TEMPORIZADOR
    // --------------------------------------------------

    function stopAuto() {

        if (autoTimer !== null) {
            clearInterval(autoTimer);
            autoTimer = null;
        }
    }

    // --------------------------------------------------
    // CIERRE DE CICLO
    // --------------------------------------------------

    function finishCycle(reason) {

        if (!risk || engineStatus !== "RUNNING") {
            return;
        }

        const openPositions = getCurrentCyclePositions();

        /*
         * Cierra las posiciones del ciclo actual.
         * PositionManager conserva el último resultado
         * calculado para cada posición.
         */

        if (openPositions.length > 0) {

            PositionManager.closeAll(reason);

        }

        /*
         * Recalcular el resultado después del cierre.
         * El resultado de las posiciones cerradas se conserva
         * en el historial y no debe sumarse dos veces.
         */

        const finalPL = calculateCyclePL();

        const statusBefore = risk.getStatus();

        /*
         * Si el ciclo sigue activo, actualizamos el resultado.
         * Si ya alcanzó un límite, conservamos ese estado.
         */

        if (statusBefore.cycleStatus === "ACTIVE") {
            risk.updateCycleProfitLoss(finalPL);
        }

        engineStatus = "WAITING";
        lastCycleEndTime = Date.now();

        const finalBalance =
            risk.getStatus().startingBalance + finalPL;

        log(
            `Ciclo finalizado: ${reason}. Resultado neto: ${finalPL.toFixed(4)} USD. Balance: ${finalBalance.toFixed(4)} USD.`,
            "warning"
        );
    }

    // --------------------------------------------------
    // ACTUALIZACIÓN DE RIESGO
    // --------------------------------------------------

    function checkRiskLimits() {

        if (!risk || engineStatus !== "RUNNING") {
            return;
        }

        const totalPL = calculateCyclePL();

        risk.updateCycleProfitLoss(totalPL);

        const status = risk.getStatus();

        if (status.cycleStatus === "TAKE_PROFIT") {

            finishCycle("TAKE_PROFIT");

        } else if (status.cycleStatus === "LOSS_LIMIT") {

            finishCycle("LOSS_LIMIT");
        }
    }

    // --------------------------------------------------
    // INICIAR UN NUEVO CICLO
    // --------------------------------------------------

    function beginNewCycle() {

        if (!risk) {
            return {
                success: false,
                reason: "El motor todavía no está inicializado."
            };
        }

        const status = risk.getStatus();

        const remainingBalance =
            Number(status.currentBalance);

        if (
            !Number.isFinite(remainingBalance) ||
            remainingBalance <= 0
        ) {
            return {
                success: false,
                reason: "No queda capital disponible para iniciar otro ciclo."
            };
        }

        /*
         * Elimina posiciones abiertas antiguas.
         * Conserva el historial de operaciones cerradas.
         */

        PositionManager.reset(false);

        cyclePositionIds.clear();
        manualPL = 0;

        risk.resetCycle(remainingBalance);

        engineStatus = "RUNNING";
        lastCycleEndTime = 0;

        log(
            `Nuevo ciclo iniciado con ${remainingBalance.toFixed(4)} USD.`,
            "success"
        );

        return {
            success: true,
            balance: remainingBalance
        };
    }

    // --------------------------------------------------
    // INICIAR MOTOR
    // --------------------------------------------------

    function start(capital = CONFIG.startingCapital) {

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

        log(
            `Motor iniciado con ${amount.toFixed(4)} USD. Objetivo: +${CONFIG.profitTarget.toFixed(2)} USD. Pérdida máxima: -${CONFIG.maxLoss.toFixed(2)} USD. Apalancamiento: ${CONFIG.leverage}x.`,
            "success"
        );

        return {
            success: true,
            balance: amount
        };
    }

    // --------------------------------------------------
    // DETENER MOTOR
    // --------------------------------------------------

    function stop() {

        stopAuto();

        if (engineStatus !== "STOPPED") {

            engineStatus = "STOPPED";

            log(
                "Motor detenido por el usuario. Las posiciones abiertas se conservan.",
                "warning"
            );
        }

        return {
            success: true,
            status: engineStatus
        };
    }

    // --------------------------------------------------
    // ANALIZAR UN PAR
    // --------------------------------------------------

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

            const currentPrice = Number(analysis.price);

            if (
                !Number.isFinite(currentPrice) ||
                currentPrice <= 0
            ) {
                throw new Error(
                    "El análisis no devolvió un precio válido."
                );
            }

            lastSignals[pair] = {
                ...analysis,
                timestamp: new Date().toISOString()
            };

            // 1. Actualizar precio de las posiciones.
            PositionManager.updatePrice(
                pair,
                currentPrice
            );

            // 2. Comprobar límites antes de abrir otra posición.
            checkRiskLimits();

            if (engineStatus !== "RUNNING") {
                return {
                    success: true,
                    analysis,
                    opened: false,
                    reason: "Se alcanzó un límite del ciclo."
                };
            }

            // 3. Verificar señal.
            if (
                analysis.signal !== "BUY" &&
                analysis.signal !== "SELL"
            ) {
                log(
                    `${pair}: sin señal de entrada.`,
                    "info"
                );

                return {
                    success: true,
                    analysis,
                    opened: false,
                    reason: "No hay señal de entrada."
                };
            }

            // 4. Comprobar máximo de posiciones.
            if (
                getCurrentCyclePositions().length >= MAX_POSITIONS
            ) {
                return {
                    success: true,
                    analysis,
                    opened: false,
                    reason: "Se alcanzó el máximo de posiciones abiertas."
                };
            }

            // 5. Calcular margen disponible.
            const riskStatus = risk.getStatus();

            const balance = Number(
                riskStatus.currentBalance
            );

            const reservedMargin =
                PositionManager.getTotalMargin();

            const availableMargin = Math.max(
                0,
                balance - reservedMargin
            );

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

            // 6. Abrir posición.
            const result = PositionManager.openPosition(
                pair,
                analysis.signal,
                margin,
                currentPrice
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
                `Nueva posición ${analysis.signal} en ${pair}. Margen: ${margin.toFixed(4)} USD. Exposición: ${result.position.exposure.toFixed(4)} USD.`,
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

            log(
                `Error analizando ${pair}: ${error.message}`,
                "error"
            );

            return {
                success: false,
                reason: error.message
            };
        }
    }

    // --------------------------------------------------
    // ANÁLISIS AUTOMÁTICO
    // --------------------------------------------------

    function runAnalysis() {

        if (!autoProvider || !risk) return;

        if (engineStatus === "WAITING") {

            const elapsed =
                Date.now() - lastCycleEndTime;

            if (elapsed < cooldownMs) return;

            let foundSignal = false;

            try {

                const pairs = [
                    "EUR/USD",
                    "GBP/USD",
                    "USD/JPY"
                ];

                for (const pair of pairs) {

                    const candles = autoProvider(pair);
                    const analysis = TradeAI.analyze(candles);

                    if (
                        analysis.signal === "BUY" ||
                        analysis.signal === "SELL"
                    ) {
                        foundSignal = true;
                        break;
                    }
                }

            } catch (error) {

                lastError = error.message;

                log(
                    `Error buscando nuevas condiciones: ${error.message}`,
                    "error"
                );

                return;
            }

            if (!foundSignal) {

                log(
                    "Esperando condiciones adecuadas para reiniciar.",
                    "info"
                );

                return;
            }

            const result = beginNewCycle();

            if (!result.success) {
                log(result.reason, "error");
                return;
            }
        }

        if (engineStatus !== "RUNNING") return;

        const pairs = [
            "EUR/USD",
            "GBP/USD",
            "USD/JPY"
        ];

        for (const pair of pairs) {

            if (engineStatus !== "RUNNING") break;

            try {

                const candles = autoProvider(pair);

                analyzePair(pair, candles);

            } catch (error) {

                lastError = error.message;

                log(
                    `Error en el ciclo automático: ${error.message}`,
                    "error"
                );
            }
        }
    }

    // --------------------------------------------------
    // ACTIVAR ANÁLISIS AUTOMÁTICO
    // --------------------------------------------------

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

        intervalSeconds = Math.max(
            1,
            Number(seconds) || 10
        );

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

    // --------------------------------------------------
    // RESULTADOS MANUALES DE PRUEBA
    // --------------------------------------------------

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

        if (value > 0) {
            lifetimeManualWins += value;
        } else if (value < 0) {
            lifetimeManualLosses += Math.abs(value);
        }

        log(
            `Resultado simulado registrado: ${value.toFixed(4)} USD.`,
            "info"
        );

        checkRiskLimits();

        return {
            success: true,
            cycleProfitLoss: calculateCyclePL()
        };
    }

    // --------------------------------------------------
    // REINICIAR CICLO
    // --------------------------------------------------

    function restartCycle() {

        if (engineStatus !== "WAITING") {
            return {
                success: false,
                reason: "El motor no está esperando un nuevo ciclo."
            };
        }

        return beginNewCycle();
    }

    // --------------------------------------------------
    // ESTADO GENERAL DEL MOTOR
    // --------------------------------------------------

    function getStatus() {

        const openPositions =
            getCurrentCyclePositions();

        const positionHistory =
            getCurrentCycleHistory();

        const riskStatus =
            getRiskStatus();

        const allTimeStats =
            calculateAllTimeStats();

        const cycleProfitLoss =
            calculateCyclePL();

        const cycleBalance = riskStatus
            ? riskStatus.startingBalance + cycleProfitLoss
            : 0;

        const openProfitLoss = openPositions.reduce(
            (total, position) =>
                total + Number(position.profitLoss || 0),
            0
        );

        const closedProfitLoss = positionHistory.reduce(
            (total, position) =>
                total + Number(position.profitLoss || 0),
            0
        );

        return {

            engineStatus,

            isRunning: engineStatus === "RUNNING",
            isWaiting: engineStatus === "WAITING",
            isStopped: engineStatus === "STOPPED",

            balance: cycleBalance,
            currentBalance: cycleBalance,
            cycleBalance,

            cycleProfitLoss,

            openProfitLoss,
            closedProfitLoss,

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
            intervalSeconds,

            config: {
                startingCapital: CONFIG.startingCapital,
                leverage: CONFIG.leverage,
                profitTarget: CONFIG.profitTarget,
                maxLoss: CONFIG.maxLoss
            }
        };
    }

    // --------------------------------------------------
    // API PÚBLICA
    // --------------------------------------------------

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
