
/*
 * TRADE AI
 * Gestor de posiciones v1.2
 * Simulación exclusivamente.
 * Conserva el historial entre ciclos.
 */

const PositionManager = (() => {

    let positions = [];
    let nextId = 1;

    const CONFIG = {
        maxPositions: 20,
        leverage: 1,
        takeProfitPercent: 1,
        stopLossPercent: 1
    };

    // Contar solamente posiciones abiertas
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
            entryPrice: price,
            currentPrice: price,
            profitLoss: 0,
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

    // Calcular resultado de una posición
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

    // Cerrar una posición
    function closePosition(position, reason) {

        if (position.status !== "OPEN") {
            return;
        }

        position.status = "CLOSED";
        position.closeReason = reason;
        position.closedAt = new Date().toISOString();
    }

    // Actualizar precio y comprobar salidas individuales
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

    // Obtener posiciones abiertas
    function getOpenPositions() {

        return positions
            .filter(position => position.status === "OPEN")
            .map(position => ({ ...position }));
    }

    // Obtener historial completo de posiciones cerradas
    function getHistory() {

        return positions
            .filter(position => position.status === "CLOSED")
            .map(position => ({ ...position }))
            .reverse();
    }

    // Calcular resultado no realizado total
    function getUnrealizedProfitLoss() {

        return getOpenPositions().reduce(
            (total, position) =>
                total + position.profitLoss,
            0
        );
    }

    // Calcular margen total comprometido
    function getTotalMargin() {

        return getOpenPositions().reduce(
            (total, position) =>
                total + position.margin,
            0
        );
    }

    // Reiniciar posiciones abiertas sin borrar el historial
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
        getUnrealizedProfitLoss,
        countOpenPositions,
        reset
    };

})();

window.PositionManager = PositionManager;
