export function getFormattedTime(numSeconds: number) {

    var prefix = numSeconds < 0 ? '-' : '';
    var absNumSeconds = Math.abs(numSeconds);
    var hours = Math.floor(absNumSeconds / 3600);
    var minutes = Math.floor(absNumSeconds % 3600 / 60);
    var seconds = Math.floor(absNumSeconds) % 60;
    return hours > 0 ? "".concat(prefix).concat(hours.toString(), ":").concat(padZero(minutes), ":").concat(padZero(seconds)) : "".concat(prefix).concat(minutes.toString(), ":").concat(padZero(seconds));
}

function padZero(digit: number): string {
    return "".concat(digit < 10 ? '0' : '').concat(digit.toString());
}
