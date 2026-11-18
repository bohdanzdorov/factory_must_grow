// The order creation form. Input is checked in the browser with the shared CreateOrderSchema,
// the same schema the API uses; the API's own field errors are shown in the same place.
import { CapabilitySchema, CreateOrderSchema, type Capability } from '@factorymustgrow/shared';
import { useState, type SyntheticEvent } from 'react';
import { useNavigate } from 'react-router';
import { ApiError } from '../../api/client';
import { useCreateOrder } from '../../api/queries';
import { useSimulatedTime } from '../../hooks/useSimulatedTime';
import { capabilityLabels, formatDateTime } from '../../lib/format';
import { ErrorMessage } from '../general/ErrorMessage';
import { FieldError } from './FieldError';

type Field = 'partName' | 'quantity' | 'requiredCapabilities' | 'deadline' | 'destination';
type FieldErrors = Partial<Record<Field, string>>;

const fields: Field[] = ['partName', 'quantity', 'requiredCapabilities', 'deadline', 'destination'];

// The first message for each field, from Zod issues or the API's error response.
function toFieldErrors(issues: { path: PropertyKey[] | string; message: string }[]): FieldErrors {
  const errors: FieldErrors = {};

  for (const issue of issues) {
    const top = String(typeof issue.path === 'string' ? issue.path.split('.')[0] : issue.path[0]);
    const field = fields.find((name) => name === top);
    if (field && !errors[field]) errors[field] = issue.message;
  }

  return errors;
}

export function NewOrderForm({
  destinations,
  defaultDeadline,
}: {
  destinations: string[];
  // In the value format of a datetime-local input; simulated time.
  defaultDeadline: string;
}) {
  const navigate = useNavigate();
  const create = useCreateOrder();
  const time = useSimulatedTime();

  const [partName, setPartName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [deadline, setDeadline] = useState(defaultDeadline);
  const [destination, setDestination] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});

  const toggleCapability = (capability: Capability) => {
    setCapabilities((current) =>
      current.includes(capability)
        ? current.filter((existing) => existing !== capability)
        : [...current, capability],
    );
  };

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();

    // The browser's datetime value has no timezone; Date reads it as local time.
    const deadlineDate = new Date(deadline);
    const parsed = CreateOrderSchema.safeParse({
      partName,
      quantity: quantity.trim() === '' ? undefined : Number(quantity),
      requiredCapabilities: capabilities,
      deadline: Number.isNaN(deadlineDate.getTime()) ? deadline : deadlineDate.toISOString(),
      destination,
    });

    const found = parsed.success ? {} : toFieldErrors(parsed.error.issues);

    // The API checks this too; checking here as well saves a round trip.
    if (parsed.success && time && Date.parse(parsed.data.deadline) <= time.now) {
      found.deadline = 'The deadline has already passed in simulated time';
    }

    setErrors(found);
    if (!parsed.success || Object.keys(found).length > 0) return;

    create.mutate(parsed.data, {
      onSuccess: () => {
        void navigate('/orders');
      },
    });
  };

  // The API's field errors, such as a deadline that passed meanwhile, shown under the field.
  const apiErrors =
    create.error instanceof ApiError ? toFieldErrors(create.error.issues) : ({} as FieldErrors);
  const shown: FieldErrors = { ...apiErrors, ...errors };
  const apiErrorHasNoField =
    create.error !== null && Object.keys(apiErrors).length === 0 ? create.error : null;

  const inputClass = (field: Field) =>
    `w-full rounded-md border bg-white px-3 py-2 text-sm ${
      shown[field] ? 'border-red-400' : 'border-slate-300'
    }`;

  return (
    <form
      onSubmit={submit}
      noValidate
      className="space-y-5 rounded-xl border border-slate-200 bg-white p-4 sm:p-6"
    >
      <div className="space-y-1">
        <label htmlFor="part-name" className="block text-sm font-medium">
          Part name
        </label>
        <input
          id="part-name"
          value={partName}
          onChange={(event) => {
            setPartName(event.target.value);
          }}
          maxLength={200}
          aria-describedby="part-name-error"
          className={inputClass('partName')}
          placeholder="For example: Bracket housing"
        />
        <FieldError id="part-name-error" message={shown.partName} />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="quantity" className="block text-sm font-medium">
            Quantity
          </label>
          <input
            id="quantity"
            type="number"
            min={1}
            max={10_000}
            step={1}
            value={quantity}
            onChange={(event) => {
              setQuantity(event.target.value);
            }}
            aria-describedby="quantity-error"
            className={inputClass('quantity')}
          />
          <FieldError id="quantity-error" message={shown.quantity} />
        </div>

        <div className="space-y-1">
          <label htmlFor="destination" className="block text-sm font-medium">
            Destination
          </label>
          <select
            id="destination"
            value={destination}
            onChange={(event) => {
              setDestination(event.target.value);
            }}
            aria-describedby="destination-error"
            className={inputClass('destination')}
          >
            <option value="">Choose a country…</option>
            {destinations.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
          <FieldError id="destination-error" message={shown.destination} />
        </div>
      </div>

      <fieldset className="space-y-2" aria-describedby="capabilities-error">
        <legend className="text-sm font-medium">Required capabilities</legend>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {CapabilitySchema.options.map((capability) => (
            <label key={capability} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={capabilities.includes(capability)}
                onChange={() => {
                  toggleCapability(capability);
                }}
                className="h-4 w-4"
              />
              {capabilityLabels[capability]}
            </label>
          ))}
        </div>
        <p className="text-xs text-slate-500">One machine must have every capability you choose.</p>
        <FieldError id="capabilities-error" message={shown.requiredCapabilities} />
      </fieldset>

      <div className="space-y-1">
        <label htmlFor="deadline" className="block text-sm font-medium">
          Deadline
        </label>
        <input
          id="deadline"
          type="datetime-local"
          value={deadline}
          onChange={(event) => {
            setDeadline(event.target.value);
          }}
          aria-describedby="deadline-hint deadline-error"
          className={`${inputClass('deadline')} sm:w-auto`}
        />
        <p id="deadline-hint" className="text-xs text-slate-500">
          When the parts must arrive, in simulated time. It's now{' '}
          {time ? formatDateTime(new Date(time.now).toISOString()) : '…'}.
        </p>
        <FieldError id="deadline-error" message={shown.deadline} />
      </div>

      {apiErrorHasNoField && <ErrorMessage error={apiErrorHasNoField} />}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={create.isPending}
          className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50"
        >
          {create.isPending ? 'Creating…' : 'Create order'}
        </button>
        <button
          type="button"
          onClick={() => {
            void navigate('/orders');
          }}
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
