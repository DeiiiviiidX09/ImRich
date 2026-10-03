
/*
 * TRADE AI
 * Gestor de posiciones v4.0
 *
 * Simulación exclusivamente.
 *
 * - Apalancamiento: 1:30.
 * - Cálculo de P/L flotante y realizado.
 * - Sin Take Profit ni Stop Loss individuales.
 * - Cierre controlado por el motor de riesgo.
 * - Conservación del historial entre ciclos.
 * - Margen recibido íntegramente desde TradeEngine.
 */

const PositionManager = (() => {

    let positions = [];
    let nextId = 1;

    const CONFIG = {
        maxPositions: 20,
        leverage: 30
    };

    function countOpenPositions() {
        return positions.filter(
            position => position.status === "OPEN"
        ).length;
    }

    function openPosition(pair, direction, amount, price) {

        if (countOpenPositions() >= CONFIG.maxPositions) {
            return {
                success: false,
                reason: "Máximo de posiciones alcanzado."
            };
        }

        const margin = Number(amount);
        const entryPrice = Number(price);

        if (
            !pair ||
            !["BUY", "SELL"].includes(direction) ||
            !Number.isFinite(margin) ||
            margin <= 0 ||
            !Number.isFinite(entryPrice) ||
            entryPrice <= 0
        ) {
            return {
                success: false,
                reason: "Datos de entrada no válidos."
            };
        }

        const position = {
            id: nextId++,
            pair,
            direction,

            margin,
            leverage: CONFIG.leverage,

            exposure: margin * CONFIG.leverage,

            entryPrice,
            currentPrice: entryPrice,

            profitLoss: 0,
            profitLossPercent: 0,

            status: "OPEN",
            openedAt: new Date().toISOString(),
            closedAt: null,
            closeReason: null,
            cycleNumber: null
        };

        positions.push(position);

        return {
            success: true,
            position: { ...position }
        };
    }

    /*
     * Calcula el resultado usando la exposición total.
     *
     * P/L = exposición × variación porcentual del precio
     *
     * Equivale a:
     * margen × apalancamiento × movimiento
     */

    function calculateProfitLoss(position, price) {

        if (
            !position ||
            !Number.isFinite(price) ||
            price <= 0 ||
            !Number.isFinite(position.entryPrice) ||
            position.entryPrice <= 0
        ) {
            return 0;
        }

        let movement;

        if (position.direction === "BUY") {
            movement =
                (price - position.entryPrice) /
                position.entryPrice;
        } else {
            movement =
                (position.entryPrice - price) /
                position.entryPrice;
        }

        return position.exposure * movement;
    }

    function updatePositionResult(position, price) {

        position.currentPrice = price;

        position.profitLoss =
            calculateProfitLoss(position, price);

        position.profitLossPercent =
            position.margin > 0
                ? (position.profitLoss / position.margin) * 100
                : 0;
    }

    function closePosition(position, reason) {

        if (position.status !== "OPEN") {
            return false;
        }

        position.status = "CLOSED";
        position.closeReason = reason;
        position.closedAt = new Date().toISOString();

        return true;
    }

    function updatePrice(pair, price) {

        const validPrice = Number(price);

        if (
            !pair ||
            !Number.isFinite(validPrice) ||
            validPrice <= 0
        ) {
            return [];
        }

        positions.forEach(position => {

            if (
                position.pair !== pair ||
                position.status !== "OPEN"
            ) {
                return;
            }

            updatePositionResult(position, validPrice);
        });

        return [];
    }

    /*
     * Cierra solamente las posiciones cuyos IDs se indiquen.
     * Esto evita cerrar posiciones ajenas al ciclo actual.
     */

    function closePositions(ids, reason = "CYCLE_LIMIT") {

        const idSet = new Set(ids || []);
        const closed = [];

        positions.forEach(position => {

            if (
                position.status !== "OPEN" ||
                !idSet.has(position.id)
            ) {
                return;
            }

            if (closePosition(position, reason)) {
                closed.push({ ...position });
            }
        });

        return closed;
    }

    function closeAll(reason = "CYCLE_LIMIT") {

        const closed = [];

        positions.forEach(position => {

            if (position.status !== "OPEN") {
                return;
            }

            if (closePosition(position, reason)) {
                closed.push({ ...position });
            }
        });

        return closed;
    }

    function getOpenPositions() {

        return positions
            .filter(position => position.status === "OPEN")
            .map(position => ({ ...position }));
    }

    function getHistory() {

        return positions
            .filter(position => position.status === "CLOSED")
            .map(position => ({ ...position }))
            .reverse();
    }

    function getUnrealizedProfitLoss() {

        return getOpenPositions().reduce(
            (total, position) =>
                total + Number(position.profitLoss || 0),
            0
        );
    }

    function getRealizedProfitLoss() {

        return getHistory().reduce(
            (total, position) =>
                total + Number(position.profitLoss || 0),
            0
        );
    }

    function getTotalMargin() {

        return getOpenPositions().reduce(
            (total, position) =>
                total + Number(position.margin || 0),
            0
        );
    }

    function getTotalExposure() {

        return getOpenPositions().reduce(
            (total, position) =>
                total + Number(position.exposure || 0),
            0
        );
    }

    function reset(clearHistory = false) {

        positions = positions.filter(
            position => position.status === "CLOSED"
        );

        if (clearHistory) {
            positions = [];
            nextId = 1;
        }
    }

    return {
        openPosition,
        updatePrice,
        closePosition,
        closePositions,
        closeAll,

        getOpenPositions,
        getHistory,

        getTotalMargin,
        getTotalExposure,

        getUnrealizedProfitLoss,
        getRealizedProfitLoss,

        countOpenPositions,
        reset
    };

})();

window.PositionManager = PositionManager;
