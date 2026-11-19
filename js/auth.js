/* ==========================================================================
   Chanel Monroe CRM — accounts (Supabase Auth)
   Email + password sign-in. The first account to sign in becomes the owner;
   anyone else who signs up waits until the owner adds them (Profile → Team).
   Access to data is enforced in the database (row-level security), not here.
   ========================================================================== */
(function () {
  const sb = DB.client;
  const emailOk = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e || '');
  const here = () => location.origin + location.pathname;

  const Auth = {
    session: null, current: null, status: 'signed-out', recovery: false, team: [],

    async init(onChange) {
      const { data } = await sb.auth.getSession();
      this.session = data.session;
      sb.auth.onAuthStateChange((event, session) => {
        this.session = session;
        if (event === 'PASSWORD_RECOVERY') this.recovery = true;
        if (event === 'USER_UPDATED' && this.current && session?.user?.id === this.current.id) {
          const changed = this.current.email !== session.user.email;
          Object.assign(this.current, { email: session.user.email, pendingEmail: session.user.new_email || '' });
          if (changed && onChange) setTimeout(() => onChange(event), 0);
        }
        if (onChange && ['PASSWORD_RECOVERY', 'SIGNED_OUT'].includes(event)) setTimeout(() => onChange(event), 0);
      });
      if (this.session) await this.loadStaff();
    },

    async loadStaff() {
      const u = this.session?.user;
      if (!u) { this.current = null; this.status = 'signed-out'; return; }
      const name = u.user_metadata?.name || '';
      const { data: state, error } = await sb.rpc('crm_claim_owner', { p_name: name || null });
      if (error) throw new Error(error.message);
      if (state === 'pending') { this.status = 'pending'; this.current = { id: u.id, email: u.email, name: name || u.email }; return; }
      const { data: row } = await sb.from('crm_staff').select('*').eq('user_id', u.id).maybeSingle();
      this.current = { id: u.id, email: u.email, pendingEmail: u.new_email || '', name: row?.name || name || u.email, role: row?.role || 'assistant' };
      this.status = 'staff';
      await this.loadTeam();
    },

    async loadTeam() {
      const { data } = await sb.from('crm_staff').select('*').order('created_at');
      this.team = (data || []).map(r => ({ id: r.user_id, name: r.name || r.email, email: r.email, role: r.role }));
    },

    restore() { return this.current; },
    isStaff() { return this.status === 'staff'; },

    async signup({ name, email, password, confirm }) {
      email = (email || '').trim().toLowerCase();
      if (!name) throw new Error('Please enter your name');
      if (!emailOk(email)) throw new Error('Please enter a valid email address');
      if ((password || '').length < 8) throw new Error('Password needs at least 8 characters');
      if (password !== confirm) throw new Error('Passwords don’t match');
      const { data, error } = await sb.auth.signUp({ email, password, options: { data: { name }, emailRedirectTo: here() } });
      if (error) throw new Error(error.message);
      if (!data.session) return 'confirm-email';
      this.session = data.session; await this.loadStaff();
      return this.status;
    },

    async login(email, password) {
      const { data, error } = await sb.auth.signInWithPassword({ email: (email || '').trim().toLowerCase(), password });
      if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Email or password is incorrect' : error.message);
      this.session = data.session; await this.loadStaff();
      return this.status;
    },

    async logout() { await sb.auth.signOut(); this.session = null; this.current = null; this.status = 'signed-out'; },

    async sendReset(email) {
      if (!emailOk(email)) throw new Error('Enter your email address first');
      const { error } = await sb.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: here() });
      if (error) throw new Error(error.message);
    },
    async setNewPassword(pw) {
      if ((pw || '').length < 8) throw new Error('Password needs at least 8 characters');
      const { error } = await sb.auth.updateUser({ password: pw });
      if (error) throw new Error(error.message);
      this.recovery = false;
    },

    async changePassword(oldPw, newPw) {
      const { error: e1 } = await sb.auth.signInWithPassword({ email: this.current.email, password: oldPw });
      if (e1) throw new Error('Current password is incorrect');
      await this.setNewPassword(newPw);
    },

    async updateMe({ name, email }) {
      const nextEmail = (email || '').trim().toLowerCase();
      if (!emailOk(nextEmail)) throw new Error('Please enter a valid email address');
      let emailStatus;
      if (nextEmail !== this.current.email?.toLowerCase()) {
        if (nextEmail === this.current.pendingEmail?.toLowerCase()) {
          emailStatus = 'confirm-email';
        } else {
          const { data, error } = await sb.auth.updateUser({ email:nextEmail }, { emailRedirectTo:here() });
          if (error) throw new Error(error.message);
          const updated = data.user?.email?.toLowerCase() === nextEmail;
          this.current.email = data.user?.email || this.current.email;
          this.current.pendingEmail = updated ? '' : data.user?.new_email || nextEmail;
          emailStatus = updated ? 'updated' : 'confirm-email';
        }
      }
      if (name && name !== this.current.name) {
        const { error } = await sb.from('crm_staff').update({ name }).eq('user_id', this.current.id);
        if (error) throw new Error(error.message);
        this.current.name = name;
      }
      await this.loadTeam();
      return emailStatus;
    },

    async addStaff(email, name) {
      const { error } = await sb.rpc('crm_add_staff', { p_email: email, p_name: name || null });
      if (error) throw new Error(error.message);
      await this.loadTeam();
    }
  };

  window.Auth = Auth;
})();
