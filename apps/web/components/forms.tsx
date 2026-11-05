"use client";
import { useActionState, useState, useId } from "react";
import { FormProvider, useForm, useFormContext } from "react-hook-form";
import { Save, LoaderCircle } from "lucide-react";
import { mutateAction, type ActionState } from "../lib/actions";
import { Button } from "./ui/button";
import { useTranslate } from "./locale";
export function Form({
  kind,
  children,
  action = mutateAction,
  submit = "Сохранить",
  id,
  version,
  className,
  icon,
  preserveValues = false,
}: {
  kind?: string;
  children?: React.ReactNode;
  action?: (state: ActionState, f: FormData) => Promise<ActionState>;
  submit?: string;
  id?: string;
  version?: number;
  className?: string;
  icon?: React.ReactNode;
  preserveValues?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const t = useTranslate();
  const methods = useForm({ mode: "onTouched" });
  return (
    <FormProvider {...methods}>
      <form
        action={formAction}
        onReset={preserveValues ? (event) => event.preventDefault() : undefined}
        className={className ? `record-form ${className}` : "record-form"}
      >
        {kind && <input type="hidden" name="kind" value={kind} />}{" "}
        {id && <input type="hidden" name="id" value={id} />}{" "}
        {version && <input type="hidden" name="version" value={version} />}
        <div className="form-grid">{children}</div>
        {state.error && (
          <p role="alert" className="form-error">
            {t(state.error)}
          </p>
        )}
        {state.success && (
          <p role="status" className="form-success">
            {t(state.success)}
          </p>
        )}
        <Button disabled={pending} type="submit">
          {pending ? (
            <LoaderCircle size={16} className="spin" />
          ) : (
            (icon ?? <Save size={16} />)
          )}{" "}
          {t(submit)}
        </Button>
      </form>
    </FormProvider>
  );
}
export function Field({
  label,
  name,
  value,
  type = "text",
  required = false,
  options,
  min,
  max,
  step,
  placeholder,
}: {
  label: string;
  name: string;
  value?: string | number;
  type?: string;
  required?: boolean;
  options?: readonly string[] | { value: string; label: string }[];
  min?: number;
  max?: number;
  step?: string;
  placeholder?: string;
}) {
  const id = useId();
  const t = useTranslate();
  const context = useFormContext();
  const binding = context?.register(name, {
    required: required ? "Обязательное поле / Required" : false,
    min:
      min === undefined
        ? undefined
        : { value: min, message: "Минимум / Minimum: " + min },
    max:
      max === undefined
        ? undefined
        : { value: max, message: "Максимум / Maximum: " + max },
  }) ?? { name };
  const error = context?.formState.errors[name];
  return (
    <label className="field" htmlFor={id}>
      <span>{t(label)}</span>
      {options ? (
        <select id={id} {...binding} defaultValue={value} required={required}>
          {options.map((o) =>
            typeof o === "string" ? (
              <option key={o} value={o}>
                {t(o)}
              </option>
            ) : (
              <option key={o.value} value={o.value}>
                {o.value === "" ? t(o.label) : o.label}
              </option>
            ),
          )}
        </select>
      ) : type === "textarea" ? (
        <textarea id={id} {...binding} defaultValue={value} rows={3} />
      ) : (
        <input
          id={id}
          {...binding}
          defaultValue={value}
          type={type}
          required={required}
          min={min}
          max={max}
          step={step}
          placeholder={placeholder}
          autoComplete={type === "password" ? "current-password" : undefined}
        />
      )}{" "}
      {error && (
        <small role="alert" className="field-error">
          {t(String(error.message))}
        </small>
      )}
    </label>
  );
}
export function Toggle({
  name,
  label,
  checked = false,
  required = false,
}: {
  name: string;
  label: string;
  checked?: boolean;
  required?: boolean;
}) {
  const t = useTranslate();
  return (
    <label className="toggle">
      <input
        name={name}
        type="checkbox"
        value="true"
        defaultChecked={checked}
        required={required}
      />
      <span>{t(label)}</span>
    </label>
  );
}
export function ResourceDetailsFields({
  initialType = "SERVER",
  values = {},
}: {
  initialType?: string;
  values?: Record<string, string | number>;
}) {
  const [type, setType] = useState(initialType);
  const translate = useTranslate();
  return (
    <>
      <label className="field">
        <span>{translate("Тип / Type")}</span>
        <select
          name="type"
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          {[
            "SERVER",
            "DATABASE",
            "OBJECT_STORAGE",
            "APPLICATION_SERVICE",
            "EXTERNAL_SERVICE",
            "NETWORK",
          ].map((t) => (
            <option key={t} value={t}>
              {translate(t)}
            </option>
          ))}
        </select>
      </label>
      {type === "SERVER" && (
        <>
          <Field name="publicIp" label="Public IP" value={values.publicIp} />
          <Field name="privateIp" label="Private IP" value={values.privateIp} />
          <Field name="os" label="OS" value={values.os} />
          <Field
            name="osVersion"
            label="Версия ОС / OS version"
            value={values.osVersion}
          />
          <Field
            name="serverTimezone"
            label="Timezone"
            value={values.serverTimezone}
          />
          <Field
            name="vcpu"
            label="vCPU"
            type="number"
            min={0}
            value={values.vcpu}
          />
          <Field
            name="ramGB"
            label="RAM, GiB"
            type="number"
            step="any"
            min={0}
            value={values.ramGB}
          />
          <Field
            name="diskGB"
            label="Disk, GiB"
            type="number"
            step="any"
            min={0}
            value={values.diskGB}
          />
        </>
      )}
      {type === "DATABASE" && (
        <>
          <Field name="engine" label="Engine" value={values.engine} />
          <Field
            name="engineVersion"
            label="Version"
            value={values.engineVersion}
          />
          <Field
            name="sizeGB"
            label="Размер, ГиБ / Size, GiB"
            type="number"
            step="any"
            min={0}
            value={values.sizeGB}
          />
        </>
      )}
      {type === "OBJECT_STORAGE" && (
        <>
          <Field name="bucket" label="Bucket" value={values.bucket} />
          <Field name="region" label="Region" value={values.region} />
          <Field
            name="capacityGB"
            label="Capacity, GiB"
            type="number"
            step="any"
            min={0}
            value={values.capacityGB}
          />
        </>
      )}
      {["APPLICATION_SERVICE", "EXTERNAL_SERVICE"].includes(type) && (
        <>
          <Field name="runtime" label="Runtime" value={values.runtime} />
          <Field
            name="serviceVersion"
            label="Версия сервиса / Service version"
            value={values.serviceVersion}
          />
        </>
      )}
      {type === "NETWORK" && (
        <Field name="cidr" label="CIDR" value={values.cidr} />
      )}
    </>
  );
}
