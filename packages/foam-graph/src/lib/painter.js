export class Painter {
    constructor() {
        this.circlesByColor = new Map();
        this.bordersByColor = new Map();
        this.texts = [];
        this.screenTexts = [];
    }
    _addCircle(x, y, radius, color, isBorder = false) {
        if (color.opacity <= 0)
            return;
        const target = isBorder ? this.bordersByColor : this.circlesByColor;
        if (!target.has(color))
            target.set(color, []);
        target.get(color).push({ x, y, radius });
    }
    _areSameColor(a, b) {
        return a.r === b.r && a.g === b.g && a.b === b.b && a.opacity === b.opacity;
    }
    circle(x, y, radius, fill, border) {
        this._addCircle(x, y, radius + 0.2, border, true);
        if (!this._areSameColor(border, fill)) {
            this._addCircle(x, y, radius, fill);
        }
        return this;
    }
    text(text, x, y, size, family, color) {
        if (color.opacity > 0) {
            this.texts.push({ x, y, text, size, family, color });
        }
        return this;
    }
    screenText(text, x, y, size, family, color) {
        if (color.opacity > 0) {
            this.screenTexts.push({ x, y, text, size, family, color });
        }
        return this;
    }
    paint(ctx) {
        // Draw borders first, then fills
        for (const target of [this.bordersByColor, this.circlesByColor]) {
            for (const [color, circles] of target.entries()) {
                ctx.beginPath();
                ctx.fillStyle = color.toString();
                for (const c of circles) {
                    ctx.arc(c.x, c.y, c.radius, 0, 2 * Math.PI, false);
                }
                ctx.closePath();
                ctx.fill();
            }
            target.clear();
        }
        // Draw labels
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        for (const label of this.texts) {
            ctx.font = `${label.size}px ${label.family}`;
            ctx.fillStyle = label.color.toString();
            ctx.fillText(label.text, label.x, label.y);
        }
        this.texts = [];
        if (this.screenTexts.length > 0) {
            ctx.save();
            const devicePixelRatio = window.devicePixelRatio || 1;
            ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            for (const label of this.screenTexts) {
                ctx.font = `${label.size}px ${label.family}`;
                ctx.fillStyle = label.color.toString();
                ctx.fillText(label.text, label.x, label.y);
            }
            ctx.restore();
            this.screenTexts = [];
        }
        return this;
    }
}
