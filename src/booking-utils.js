// Pure helpers for the vehicle fields of a booking (no Firebase, so they are unit-testable).
export const VEHICLE_TYPES = ['Van', 'Truck'];
export const TRUCK_TYPES = ['40footer', '20footer', '10ton', '5ton', '3ton', '1ton'];
export const PALLET_OPTIONS = [{ value: 'yes', label: 'Palletized' }, { value: 'no', label: 'Not palletized' }];

/** 'Van' or 'Truck'. Bookings made before vehicle type existed have a truck type, so they count as Truck. */
export const vehicleOf = (b) => b.vehicleType || (b.truckType ? 'Truck' : '');

/** Short text for chips and lists: "Van", or the truck type ("10ton"). */
export const vehicleText = (b) => (vehicleOf(b) === 'Van' ? 'Van' : (b.truckType || ''));

/** "Palletized" / "Not palletized" / '' when not recorded (older bookings). */
export const palletText = (b) => (b.palletized === true ? 'Palletized' : b.palletized === false ? 'Not palletized' : '');

/** Fields to send to Firestore for the vehicle part; unused ones are returned as undefined. */
export function vehicleFields(f) {
  const van = f.vehicleType === 'Van';
  return {
    vehicleType: f.vehicleType,
    truckType: van ? undefined : f.truckType,
    palletized: f.palletized === 'yes' ? true : false,
    plateNumber: (f.plateNumber || '').trim().replace(/\s+/g, ' ') || undefined
  };
}

/** Returns an error message, or '' when the vehicle fields are valid. */
export function vehicleProblem(f) {
  if (!VEHICLE_TYPES.includes(f.vehicleType)) return 'Choose the type of vehicle (Van or Truck).';
  if (f.vehicleType === 'Truck' && !TRUCK_TYPES.includes(f.truckType)) return 'Choose the type of truck.';
  if (!(f.truckCount >= 1 && f.truckCount <= 6)) return 'Choose the number of vehicles (1-6).';
  if (f.palletized !== 'yes' && f.palletized !== 'no') return 'Choose whether the cargo is palletized.';
  if ((f.plateNumber || '').length > 100) return 'Plate number is too long (max 100 characters).';
  return '';
}
