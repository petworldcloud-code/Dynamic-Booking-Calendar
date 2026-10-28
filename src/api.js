// Single backend facade used by the UI. Real Firebase by default; an in-browser mock only when
// VITE_DEMO_MODE=demo (layout checks, never production data).
import * as auth from './auth.js';
import * as bookings from './bookings.js';
import * as users from './users.js';
import * as retention from './retention.js';
import { isConfigured } from './firebase.js';
import * as demo from './demo.js';

export const DEMO = import.meta.env.VITE_DEMO_MODE === 'demo';
export const CONFIGURED = DEMO || isConfigured;

const real = {
  watchSession: auth.watchSession, login: auth.login, logout: auth.logout,
  resetPassword: auth.resetPassword, adminCreateUser: auth.adminCreateUser,
  changePassword: auth.changePassword,
  watchRange: bookings.watchRange, watchList: bookings.watchList,
  createBooking: bookings.createBooking, updateBooking: bookings.updateBooking,
  deleteBooking: bookings.deleteBooking, millis: bookings.millis,
  watchUsers: users.watchUsers, updateUser: users.updateUser,
  getRetention: retention.getRetention, saveRetention: retention.saveRetention
};

export const api = DEMO ? demo.api : real;
