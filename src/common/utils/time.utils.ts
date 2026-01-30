export class TimeUtils {
    /**
     * Verifica si la hora actual está dentro del rango operativo.
     * Rango: Lunes a Domingo, 10:00 AM a 7:00 PM (19:00).
     * @param date Fecha a verificar (por defecto now)
     * @returns true si está dentro del horario, false si no
     */
    static isWithinOperatingHours(date: Date = new Date()): boolean {
        const hours = date.getHours();
        const startHour = 10;
        const endHour = 19; // 7 PM

        // El rango es [10, 19). Es decir, de 10:00:00 a 18:59:59.
        // Si son las 19:00 ya está fuera? 
        // User dijo "10 am a 7 pm". Usualmente incluye hasta las 7:00pm o hasta las 6:59pm.
        // Asumiremos >= 10 y < 19 para ser estrictos, o <= 19 si queremos incluir las 7 en punto.
        // Si dice "a 7pm", normalmente se corta a las 19:00.
        // Usaré hour >= 10 && hour < 19. (Cubre de 10:00 a 18:59).

        // CORRECCION: Si quiere "L-D (10 am a 7 pm)", probablemente quiera que mensajes salgan hasta las 7pm.
        // Si uso < 19, a las 18:59 sale, a las 19:00 no.
        return hours >= startHour && hours < endHour;
    }
}
