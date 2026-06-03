import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createTransport, Transporter } from 'nodemailer';
import { IsNull, Not, Repository } from 'typeorm';
import { Vendedor } from '../auth/entities/vendedor.entity';
import { Cita } from '../citas/entities/cita.entity';
import { Lead } from '../inbox/entities/lead.entity';
import { SesionConversacion } from '../ia/entities/sesion-conversacion.entity';
import { VendedorProyecto } from '../proyectos/entities/asesor-proyecto.entity';
import { WapiService } from '../webhook_meta/wapi.service';
import {
    CanalNotificacionAsesor,
    EventoNotificacionAsesor,
    PlantillaNotificacionAsesor,
} from './entities/plantilla-notificacion-asesor.entity';

const EMAIL_NOTIFICATIONS_KEY = 'EMAIL_NOTIFICATIONS';
const EMAIL_APP_PASSWORD_KEY = 'EMAIL_APP_PASSWORD';
const EMAIL_SSL_VERIFY_KEY = 'EMAIL_SSL_VERIFY';
const EMAIL_SSL_VERIFY_DISABLED = 'false';
const EMAIL_SERVICE_GMAIL = 'gmail';
const ESTADO_VENDEDOR_ACTIVO = 'activo';
const REMITENTE_NOTIFICACIONES_CITAS = 'Checor';
const ASUNTO_CITA_LEAD_CALIENTE = 'Nueva cita agendada con lead caliente';
const TEXTO_SIN_DATO = 'No registrado';
const TEXTO_TIPO_CITA_DEFAULT = 'PRESENCIAL';
const TEXTO_PROYECTO_DEFAULT = 'Proyecto no especificado';
const PARAM_ASESOR_NOMBRE = 'asesor_nombre';
const PARAM_LEAD_NOMBRE = 'lead_nombre';
const PARAM_LEAD_TELEFONO = 'lead_telefono';
const PARAM_LEAD_EMAIL = 'lead_email';
const PARAM_LEAD_DNI = 'lead_dni';
const PARAM_PROYECTO = 'proyecto';
const PARAM_FECHA_CITA = 'fecha_cita';
const PARAM_HORA_CITA = 'hora_cita';
const PARAM_TIPO_CITA = 'tipo_cita';
const PARAM_CITA_ID = 'cita_id';
const PARAM_RESUMEN_CONVERSACION = 'resumen_conversacion';

interface DatosNotificacionCitaCaliente {
    Cita: Cita;
    CodigoEmpresa: number;
    LeadUuid: string;
}

@Injectable()
export class NotificacionesCitasService {
    private readonly Logger = new Logger(NotificacionesCitasService.name);
    private readonly Transporter: Transporter;

    constructor(
        private readonly ConfigService: ConfigService,
        private readonly WapiService: WapiService,
        @InjectRepository(Vendedor)
        private readonly VendedorRepo: Repository<Vendedor>,
        @InjectRepository(Lead)
        private readonly LeadRepo: Repository<Lead>,
        @InjectRepository(SesionConversacion)
        private readonly SesionRepo: Repository<SesionConversacion>,
        @InjectRepository(VendedorProyecto)
        private readonly VendedorProyectoRepo: Repository<VendedorProyecto>,
        @InjectRepository(PlantillaNotificacionAsesor)
        private readonly PlantillaNotificacionAsesorRepo: Repository<PlantillaNotificacionAsesor>,
    ) {
        this.Transporter = createTransport({
            service: EMAIL_SERVICE_GMAIL,
            auth: {
                user: this.ConfigService.get<string>(EMAIL_NOTIFICATIONS_KEY),
                pass: this.ConfigService.get<string>(EMAIL_APP_PASSWORD_KEY),
            },
            ...(this.ConfigService.get<string>(EMAIL_SSL_VERIFY_KEY) === EMAIL_SSL_VERIFY_DISABLED && {
                tls: {
                    rejectUnauthorized: false,
                },
            }),
        });

        this.VerificarConfiguracionSmtp();
    }

    async NotificarCitaLeadCaliente(Datos: DatosNotificacionCitaCaliente): Promise<void> {
        const LeadAsignado = await this.ObtenerLead(Datos.LeadUuid, Datos.CodigoEmpresa);
        const SesionActual = await this.ObtenerSesionConversacion(Datos.CodigoEmpresa, Datos.LeadUuid);
        const AsesorAsignado = await this.ObtenerAsesorNotificacion(Datos.Cita, Datos.LeadUuid, LeadAsignado, SesionActual);

        if (!AsesorAsignado) {
            this.Logger.warn(`No se encontro asesor para notificar cita ${Datos.Cita.id}`);
            return;
        }

        const VariablesMensaje = this.ConstruirVariablesMensaje(AsesorAsignado, LeadAsignado, Datos.Cita, SesionActual);
        await this.EnviarCorreoAsesor(AsesorAsignado, Datos.Cita, VariablesMensaje);
        await this.EnviarWhatsappAsesor(Datos.CodigoEmpresa, AsesorAsignado, Datos.Cita, VariablesMensaje);
    }

    private async VerificarConfiguracionSmtp(): Promise<void> {
        try {
            await this.Transporter.verify();
        } catch (ErrorSmtp) {
            this.Logger.error(`Error validando SMTP: ${ErrorSmtp.message}`);
        }
    }

    private async ObtenerLead(LeadUuid: string, CodigoEmpresa: number): Promise<Lead | null> {
        if (!LeadUuid) {
            return null;
        }

        return this.LeadRepo.findOne({
            where: {
                uuid: LeadUuid,
                codigoEmpresa: CodigoEmpresa,
            },
        });
    }

    private async ObtenerAsesorNotificacion(
        CitaAgendada: Cita,
        LeadUuid: string,
        LeadAsignado: Lead | null,
        SesionActual: SesionConversacion | null,
    ): Promise<Vendedor | null> {
        const AsesorSesion = await this.ObtenerAsesorSesion(CitaAgendada.codigoEmpresa, SesionActual);

        if (AsesorSesion) {
            return AsesorSesion;
        }

        return this.AsignarAsesorRoundRobin(CitaAgendada, LeadUuid, LeadAsignado, SesionActual);
    }

    private async ObtenerSesionConversacion(
        CodigoEmpresa: number,
        LeadUuid: string,
    ): Promise<SesionConversacion | null> {
        if (!LeadUuid) {
            return null;
        }

        return this.SesionRepo.findOne({
            where: {
                leadUuid: LeadUuid,
                codigoEmpresa: CodigoEmpresa,
            },
        });
    }

    private async ObtenerAsesorSesion(
        CodigoEmpresa: number,
        SesionActual: SesionConversacion | null,
    ): Promise<Vendedor | null> {
        if (!SesionActual?.asesorId) {
            return null;
        }

        return this.VendedorRepo.findOne({
            where: {
                id: SesionActual.asesorId,
                codigoEmpresa: CodigoEmpresa,
            },
        });
    }

    private async AsignarAsesorRoundRobin(
        CitaAgendada: Cita,
        LeadUuid: string,
        LeadAsignado: Lead | null,
        SesionActual: SesionConversacion | null,
    ): Promise<Vendedor | null> {
        const AsesoresProyecto = await this.ObtenerAsesoresProyecto(CitaAgendada);
        if (!AsesoresProyecto.length) {
            return null;
        }

        const UltimaSesionAsignada = await this.SesionRepo.findOne({
            where: {
                proyectoId: CitaAgendada.proyectoId,
                codigoEmpresa: CitaAgendada.codigoEmpresa,
                asesorId: Not(IsNull()),
            },
            order: {
                updatedAt: 'DESC',
                id: 'DESC',
            },
        });

        const AsesorSeleccionado = this.ObtenerSiguienteAsesorRoundRobin(
            AsesoresProyecto,
            UltimaSesionAsignada?.asesorId || null,
        );

        if (!AsesorSeleccionado) {
            return null;
        }

        await this.GuardarAsesorEnSesion(CitaAgendada, LeadUuid, LeadAsignado, SesionActual, AsesorSeleccionado.id);
        return AsesorSeleccionado;
    }

    private ObtenerSiguienteAsesorRoundRobin(
        AsesoresProyecto: Vendedor[],
        UltimoAsesorId: number | null,
    ): Vendedor | null {
        if (!AsesoresProyecto.length) {
            return null;
        }

        if (!UltimoAsesorId) {
            return AsesoresProyecto[0];
        }

        const IndiceUltimoAsesor = AsesoresProyecto.findIndex((AsesorActual) => AsesorActual.id === UltimoAsesorId);
        if (IndiceUltimoAsesor < 0) {
            return AsesoresProyecto[0];
        }

        const IndiceSiguienteAsesor = (IndiceUltimoAsesor + 1) % AsesoresProyecto.length;
        return AsesoresProyecto[IndiceSiguienteAsesor];
    }

    private async GuardarAsesorEnSesion(
        CitaAgendada: Cita,
        LeadUuid: string,
        LeadAsignado: Lead | null,
        SesionActual: SesionConversacion | null,
        AsesorId: number,
    ): Promise<void> {
        if (!LeadUuid) {
            return;
        }

        if (SesionActual) {
            SesionActual.asesorId = AsesorId;
            if (!SesionActual.proyectoId && CitaAgendada.proyectoId) {
                SesionActual.proyectoId = CitaAgendada.proyectoId;
            }

            if (!SesionActual.numeroTelefono && LeadAsignado?.telefono) {
                SesionActual.numeroTelefono = LeadAsignado.telefono;
            }

            await this.SesionRepo.save(SesionActual);
            return;
        }

        const NuevaSesion = this.SesionRepo.create({
            leadUuid: LeadUuid,
            codigoEmpresa: CitaAgendada.codigoEmpresa,
            numeroTelefono: LeadAsignado?.telefono || null,
            proyectoId: CitaAgendada.proyectoId || null,
            asesorId: AsesorId,
        });
        await this.SesionRepo.save(NuevaSesion);
    }

    private async ObtenerAsesoresProyecto(CitaAgendada: Cita): Promise<Vendedor[]> {
        if (!CitaAgendada.proyectoId) {
            return [];
        }

        const AsignacionesProyecto = await this.VendedorProyectoRepo.find({
            where: {
                proyectoId: CitaAgendada.proyectoId,
            },
            relations: ['vendedor'],
            order: {
                createdAt: 'ASC',
            },
        });

        return AsignacionesProyecto
            .map((Asignacion) => Asignacion.vendedor)
            .filter((AsesorActual) => this.EsAsesorProyectoActivo(AsesorActual, CitaAgendada.codigoEmpresa));
    }

    private EsAsesorProyectoActivo(AsesorActual: Vendedor | null | undefined, CodigoEmpresa: number): AsesorActual is Vendedor {
        if (!AsesorActual) {
            return false;
        }

        return AsesorActual.estado === ESTADO_VENDEDOR_ACTIVO
            && AsesorActual.codigoEmpresa === CodigoEmpresa;
    }

    private async EnviarCorreoAsesor(
        Asesor: Vendedor,
        CitaAgendada: Cita,
        VariablesMensaje: Record<string, string>,
    ): Promise<void> {
        if (!Asesor.email) {
            this.Logger.warn(`Asesor ${Asesor.id} sin correo para cita ${CitaAgendada.id}`);
            return;
        }

        const EmailNotificaciones = this.ConfigService.get<string>(EMAIL_NOTIFICATIONS_KEY);

        if (!EmailNotificaciones) {
            this.Logger.warn(`No se envio correo de cita ${CitaAgendada.id}: falta ${EMAIL_NOTIFICATIONS_KEY}`);
            return;
        }

        const PlantillaEmail = await this.ObtenerPlantilla(
            CitaAgendada.codigoEmpresa,
            CanalNotificacionAsesor.EMAIL,
        );
        const MensajeTexto = this.ProcesarContenidoPlantilla(PlantillaEmail?.contenido, VariablesMensaje);
        const Asunto = PlantillaEmail?.asunto || ASUNTO_CITA_LEAD_CALIENTE;

        await this.Transporter.sendMail({
            from: `"${REMITENTE_NOTIFICACIONES_CITAS}" <${EmailNotificaciones}>`,
            to: Asesor.email,
            subject: Asunto,
            text: MensajeTexto,
        });

        this.Logger.log(`Correo de cita ${CitaAgendada.id} enviado a asesor ${Asesor.id}`);
    }

    private async EnviarWhatsappAsesor(
        CodigoEmpresa: number,
        Asesor: Vendedor,
        CitaAgendada: Cita,
        VariablesMensaje: Record<string, string>,
    ): Promise<void> {
        if (!Asesor.telefono) {
            this.Logger.warn(`Asesor ${Asesor.id} sin telefono para cita ${CitaAgendada.id}`);
            return;
        }

        const PlantillaWhatsapp = await this.ObtenerPlantilla(
            CitaAgendada.codigoEmpresa,
            CanalNotificacionAsesor.WHATSAPP,
        );

        if (PlantillaWhatsapp?.nombreTemplateWhatsapp) {
            const Componentes = this.ConstruirComponentesWhatsapp(PlantillaWhatsapp, VariablesMensaje);
            await this.WapiService.sendTemplate(
                CodigoEmpresa,
                Asesor.telefono,
                PlantillaWhatsapp.nombreTemplateWhatsapp,
                PlantillaWhatsapp.idioma,
                Componentes,
            );
        } else {
            const MensajeTexto = this.ProcesarContenidoPlantilla(PlantillaWhatsapp?.contenido, VariablesMensaje);
            await this.WapiService.sendMessage(CodigoEmpresa, Asesor.telefono, MensajeTexto);
        }

        this.Logger.log(`WhatsApp de cita ${CitaAgendada.id} enviado a asesor ${Asesor.id}`);
    }

    private async ObtenerPlantilla(
        CodigoEmpresa: number,
        Canal: CanalNotificacionAsesor,
    ): Promise<PlantillaNotificacionAsesor | null> {
        return this.PlantillaNotificacionAsesorRepo.findOne({
            where: {
                codigoEmpresa: CodigoEmpresa,
                canal: Canal,
                evento: EventoNotificacionAsesor.CITA_LEAD_CALIENTE,
                activo: true,
            },
        });
    }

    private ConstruirVariablesMensaje(
        Asesor: Vendedor,
        LeadAsignado: Lead | null,
        CitaAgendada: Cita,
        SesionActual: SesionConversacion | null,
    ): Record<string, string> {
        const NombreLead = this.ObtenerNombreLead(LeadAsignado);
        const TelefonoLead = LeadAsignado?.telefono || TEXTO_SIN_DATO;
        const EmailLead = LeadAsignado?.email || TEXTO_SIN_DATO;
        const DniLead = LeadAsignado?.dni || TEXTO_SIN_DATO;
        const Proyecto = CitaAgendada.nombreProyecto || TEXTO_PROYECTO_DEFAULT;
        const TipoCita = CitaAgendada.tipoCita || TEXTO_TIPO_CITA_DEFAULT;
        const ResumenConversacion = SesionActual?.resumenConversacion || TEXTO_SIN_DATO;

        return {
            [PARAM_ASESOR_NOMBRE]: Asesor.nombre || TEXTO_SIN_DATO,
            [PARAM_LEAD_NOMBRE]: NombreLead,
            [PARAM_LEAD_TELEFONO]: TelefonoLead,
            [PARAM_LEAD_EMAIL]: EmailLead,
            [PARAM_LEAD_DNI]: DniLead,
            [PARAM_PROYECTO]: Proyecto,
            [PARAM_FECHA_CITA]: String(CitaAgendada.fechaCita || TEXTO_SIN_DATO),
            [PARAM_HORA_CITA]: String(CitaAgendada.horaCita || TEXTO_SIN_DATO),
            [PARAM_TIPO_CITA]: TipoCita,
            [PARAM_CITA_ID]: String(CitaAgendada.id),
            [PARAM_RESUMEN_CONVERSACION]: ResumenConversacion,
        };
    }

    private ProcesarContenidoPlantilla(
        ContenidoPlantilla: string | undefined,
        VariablesMensaje: Record<string, string>,
    ): string {
        let ContenidoProcesado = ContenidoPlantilla || this.ConstruirMensajeDefault();

        for (const NombreParametro of Object.keys(VariablesMensaje)) {
            const RegexParametro = new RegExp(`\\{\\{${NombreParametro}\\}\\}`, 'g');
            ContenidoProcesado = ContenidoProcesado.replace(RegexParametro, VariablesMensaje[NombreParametro]);
        }

        return ContenidoProcesado;
    }

    private ConstruirComponentesWhatsapp(
        PlantillaWhatsapp: PlantillaNotificacionAsesor,
        VariablesMensaje: Record<string, string>,
    ): Array<{ type: string; parameters: Array<{ type: string; parameter_name: string; text: string }> }> {
        const ParametrosPlantilla = Array.isArray(PlantillaWhatsapp.parametros)
            ? PlantillaWhatsapp.parametros
            : [];

        const ParametrosBody = ParametrosPlantilla.map((NombreParametro) => ({
            type: 'text',
            parameter_name: NombreParametro,
            text: VariablesMensaje[NombreParametro] || TEXTO_SIN_DATO,
        }));

        return ParametrosBody.length > 0
            ? [{ type: 'body', parameters: ParametrosBody }]
            : [];
    }

    private ConstruirMensajeDefault(): string {
        return [
            `Hola {{${PARAM_ASESOR_NOMBRE}}}, tienes una nueva cita con un lead caliente.`,
            `Lead: {{${PARAM_LEAD_NOMBRE}}}`,
            `Telefono: {{${PARAM_LEAD_TELEFONO}}}`,
            `Email: {{${PARAM_LEAD_EMAIL}}}`,
            `DNI: {{${PARAM_LEAD_DNI}}}`,
            `Proyecto: {{${PARAM_PROYECTO}}}`,
            `Fecha: {{${PARAM_FECHA_CITA}}}`,
            `Hora: {{${PARAM_HORA_CITA}}}`,
            `Tipo: {{${PARAM_TIPO_CITA}}}`,
            `Cita ID: {{${PARAM_CITA_ID}}}`,
            `Resumen conversacion: {{${PARAM_RESUMEN_CONVERSACION}}}`,
        ].join('\n');
    }

    private ObtenerNombreLead(LeadAsignado: Lead | null): string {
        if (!LeadAsignado) {
            return TEXTO_SIN_DATO;
        }

        return LeadAsignado.nombreCompleto || LeadAsignado.nombreMeta || TEXTO_SIN_DATO;
    }
}
