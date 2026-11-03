import { ActionForm } from "@/components/action-form";
import { TextField } from "@/components/ui/fields";
import { changeOwnPassword } from "@/lib/actions/account";
import { PASSWORD_MIN_LENGTH } from "@/lib/logic/password";

export function PasswordForm({ forced = false }: { forced?: boolean }) {
  return (
    <ActionForm action={changeOwnPassword} submitLabel="Cambiar contraseña" resetOnSuccess className="max-w-md">
      {forced && <input type="hidden" name="forced" value="1" />}
      <TextField label="Contraseña actual" name="current" type="password" autoComplete="current-password" required />
      <TextField
        label="Contraseña nueva"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        hint={`Mínimo ${PASSWORD_MIN_LENGTH} caracteres, con letras y números.`}
      />
      <TextField label="Repite la contraseña nueva" name="confirm" type="password" autoComplete="new-password" required />
    </ActionForm>
  );
}
