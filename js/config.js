/* Public connection settings. The publishable key is designed to be public:
   all client data is protected by Supabase sign-in + row-level security
   (only accounts listed in crm_staff can read or change anything). */
window.CRM_CONFIG = {
  supabaseUrl: 'https://qxiugfatpybldluipcyy.supabase.co',
  supabaseKey: 'sb_publishable_sGLIpIxvos66FLVI9vPSbg_qXsTT6rt',
  photoBucket: 'crm-photos'
};
