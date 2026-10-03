
/*
 * TRADE AI
 * Gestor de posiciones v3.0
 * Simulación exclusivamente.
 *
 * Configuración:
 * - Apalancamiento 1:30.
 * - Capital inicial gestionado por el motor de riesgo.
 * - Sin Take Profit ni Stop Loss individuales.
 * - El motor principal controla los límites del ciclo:
 *      Ganancia neta: +$0.20
 *      Pérdida máxima: -$5.00
 * - Cálculo de P/L realizado y flotante.
 * - Conservación del historial entre ciclos.
 * - Validación de precios y cantidades.
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

        if (
            !pair ||
            !["BUY", "SELL"].includes(direction) ||
            !Number.isFinite(amount) ||
            amount <= 0 ||
            !Number.isFinite(price) ||
            price <= 0
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

            margin: amount,
            leverage: CONFIG.leverage,

            // Exposición total de la operación.
            exposure: amount * CONFIG.leverage,

            entryPrice: price,
            currentPrice: price,

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
     * Calcula el resultado de una posición.
     *
     * P/L = margen × variación del precio × apalancamiento
     *
     * Ejemplo:
     * Margen: $1
     * Apalancamiento: 30x
     * Movimiento favorable: 1%
     * Ganancia: $0.30
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

        return (
            position.margin *
            movement *
            position.leverage
        );
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

    /*
     * Actualiza el precio de todas las posiciones abiertas
     * de un par.
     *
     * IMPORTANTE:
     * No cierra posiciones individualmente.
     * El motor principal debe comprobar el P/L neto del ciclo
     * y ordenar el cierre cuando se alcance +$0.20 o -$5.00.
     */

    function updatePrice(pair, price) {

        if (
            !pair ||
            !Number.isFinite(price) ||
            price <= 0
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

            updatePositionResult(position, price);
        });

        // Se mantiene el array de retorno para compatibilidad
        // con el motor de trading existente.
        return [];
    }

    /*
     * Cierra todas las posiciones abiertas.
     * Conserva el último P/L calculado para cada una.
     */

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
                total + position.margin,
            0
        );
    }

    function getTotalExposure() {

        return getOpenPositions().reduce(
            (total, position) =>
                total + position.exposure,
            0
        );
    }

    /*
     * Reinicia las posiciones abiertas sin borrar el historial.
     * clearHistory=true elimina todo el historial.
     */

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
