
/*
 * TRADE AI
 * Gestor de posiciones v1.2
 * Simulación exclusivamente.
 * No ejecuta órdenes reales.
 */

const PositionManager = (() => {

    let positions = [];
    let nextId = 1;

    const CONFIG = {
        maxPositions: 3,
        leverage: 10,
        takeProfitPercent: 10,
        stopLossPercent: 20
    };

    // Contar solamente las posiciones abiertas
    function countOpenPositions() {
        return positions.filter(
            position => position.status === "OPEN"
        ).length;
    }

    // Abrir una posición simulada
    function openPosition(pair, direction, amount, price) {

        if (countOpenPositions() >= CONFIG.maxPositions) {
            return {
                success: false,
                reason: "Se alcanzó el máximo de posiciones abiertas."
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

        const alreadyOpen = positions.some(
            position =>
                position.pair === pair &&
                position.status === "OPEN"
        );

        if (alreadyOpen) {
            return {
                success: false,
                reason: "Ya existe una posición abierta en este par."
            };
        }

        const position = {
            id: nextId++,
            pair,
            direction,
            margin: amount,
            leverage: CONFIG.leverage,
            entryPrice: price,
            currentPrice: price,
            profitLoss: 0,
            status: "OPEN",
            openedAt: new Date().toISOString(),
            closedAt: null,
            closeReason: null
        };

        positions.push(position);

        return {
            success: true,
            position: { ...position }
        };
    }

    // Calcular el resultado de una posición
    function calculateProfitLoss(position, price) {

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

    // Calcular el resultado flotante de todas las posiciones
    function getTotalUnrealizedProfitLoss() {

        return getOpenPositions().reduce(
            (total, position) =>
                total + position.profitLoss,
            0
        );
    }

    // Cerrar una posición
    function closePosition(position, reason) {

        if (position.status !== "OPEN") {
            return;
        }

        position.status = "CLOSED";
        position.closeReason = reason;
        position.closedAt = new Date().toISOString();
    }

    // Actualizar precio y comprobar salida individual
    function updatePrice(pair, price) {

        if (!Number.isFinite(price) || price <= 0) {
            return [];
        }

        const closed = [];

        positions.forEach(position => {

            if (
                position.pair !== pair ||
                position.status !== "OPEN"
            ) {
                return;
            }

            position.currentPrice = price;

            position.profitLoss =
                calculateProfitLoss(position, price);

            const profitTarget =
                position.margin *
                CONFIG.takeProfitPercent / 100;

            const lossLimit =
                position.margin *
                CONFIG.stopLossPercent / 100;

            if (position.profitLoss >= profitTarget) {

                closePosition(position, "TAKE_PROFIT");
                closed.push({ ...position });

            } else if (position.profitLoss <= -lossLimit) {

                closePosition(position, "STOP_LOSS");
                closed.push({ ...position });

            }
        });

        return closed;
    }

    // Cerrar todas las posiciones abiertas
    function closeAll(reason = "CYCLE_LIMIT") {

        const closed = [];

        positions.forEach(position => {

            if (position.status === "OPEN") {

                closePosition(position, reason);
                closed.push({ ...position });

            }
        });

        return closed;
    }

    // Consultar posiciones abiertas
    function getOpenPositions() {

        return positions
            .filter(position => position.status === "OPEN")
            .map(position => ({ ...position }));
    }

    // Consultar solamente el historial cerrado
    function getHistory() {

        return positions
            .filter(position => position.status === "CLOSED")
            .map(position => ({ ...position }));
    }

    // Consultar exposición total
    function getTotalMargin() {

        return getOpenPositions().reduce(
            (total, position) => total + position.margin,
            0
        );
    }

    // Reiniciar el simulador
    function reset() {

        positions = [];
        nextId = 1;
    }

    return {
        openPosition,
        updatePrice,
        closeAll,
        getOpenPositions,
        getHistory,
        getTotalMargin,
        getTotalUnrealizedProfitLoss,
        countOpenPositions,
        reset
    };

})();

window.PositionManager = PositionManager;
