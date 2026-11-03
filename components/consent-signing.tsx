import { ActionForm } from "@/components/action-form";
import { FilePicker } from "@/components/file-picker";
import { SignaturePad } from "@/components/signature-pad";
import { CheckboxField, TextField } from "@/components/ui/fields";
import { Section } from "@/components/ui/misc";
import { signConsentOnPaper, signConsentOnScreen } from "@/lib/actions/consents";

interface ConsentSigningProps {
  consentId: string;
  signerName: string;
  signerDocument: string;
  canUpload: boolean;
  /** Ruta interna a la que se va al terminar de firmar. */
  next?: string;
}

/**
 * Las dos formas de resolver una autorización pendiente: firmar en pantalla o
 * registrar que ya se firmó en físico (con copia opcional). Se usa en la ficha
 * de la autorización y en el paso obligatorio de datos del tutor nuevo.
 */
export function ConsentSigning({ consentId, signerName, signerDocument, canUpload, next }: ConsentSigningProps) {
  return (
    <>
      <Section title="Opción 1 · Firmar en pantalla">
        <ActionForm action={signConsentOnScreen.bind(null, consentId)} submitLabel="Firmar autorización">
          {next && <input type="hidden" name="next" value={next} />}
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Nombre completo de quien firma" name="signer_name" defaultValue={signerName} required />
            <TextField label="Cédula de quien firma" name="signer_document" defaultValue={signerDocument} required />
          </div>
          <SignaturePad />
          <CheckboxField label="Confirmo que leí el contenido completo y lo acepto." name="accepted" />
        </ActionForm>
      </Section>

      <Section title="Opción 2 · Ya firmó en físico">
        <ActionForm
          action={signConsentOnPaper.bind(null, consentId)}
          submitLabel="Registrar que ya firmó"
          encType="multipart/form-data"
        >
          {next && <input type="hidden" name="next" value={next} />}
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Nombre completo de quien firmó" name="signer_name" defaultValue={signerName} required />
            <TextField label="Cédula de quien firmó" name="signer_document" defaultValue={signerDocument} required />
          </div>
          {canUpload && (
            <FilePicker
              accept="application/pdf,image/png,image/jpeg,image/webp"
              label="Adjuntar foto o PDF del documento firmado (opcional)"
              hint="Guardar la copia sirve de respaldo si alguien reclama; sin ella queda anotado que se firmó en físico."
            />
          )}
          <CheckboxField label="Confirmo que el tutor ya firmó esta autorización en físico." name="accepted" />
        </ActionForm>
      </Section>
    </>
  );
}
