type FieldErrorProps = {
  id: string
  message?: string | null
}

export const FieldError = ({ id, message }: FieldErrorProps) =>
  message ? (
    <p id={id} className="text-xs font-medium text-destructive">
      {message}
    </p>
  ) : null
