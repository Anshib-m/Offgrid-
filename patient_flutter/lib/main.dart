import 'dart:async';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'api.dart';

const brand = Color(0xFF0F766E);
const recordCats = ['SURGERY', 'LAB', 'IMAGING', 'MEDICATION', 'ALLERGY', 'DIAGNOSIS', 'CONSULTATION', 'DISCHARGE', 'OTHER'];

String label(String c) => c == 'PROFILE' ? 'Personal info' : c[0] + c.substring(1).toLowerCase();
String fmtDate(String d) {
  final t = DateTime.parse(d).toLocal();
  const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return '${t.day} ${m[t.month - 1]} ${t.year}';
}

String fmtTime(String d) {
  final t = DateTime.parse(d).toLocal();
  return '${fmtDate(d)} ${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';
}

void main() => runApp(const OffgridApp());

class OffgridApp extends StatelessWidget {
  const OffgridApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'Offgrid',
        theme: ThemeData(colorSchemeSeed: brand, useMaterial3: true, scaffoldBackgroundColor: const Color(0xFFF4F7F6)),
        home: const Gate(),
      );
}

void toast(BuildContext c, String msg) => ScaffoldMessenger.of(c).showSnackBar(SnackBar(content: Text(msg)));

/// Runs [fn], shows the error as a snackbar. Returns true on success.
Future<bool> guard(BuildContext c, Future<void> Function() fn) async {
  try {
    await fn();
    return true;
  } catch (e) {
    if (c.mounted) toast(c, e.toString());
    return false;
  }
}

class Gate extends StatefulWidget {
  const Gate({super.key});
  @override
  State<Gate> createState() => _GateState();
}

class _GateState extends State<Gate> {
  bool? authed;
  @override
  void initState() {
    super.initState();
    Api.load().then((v) => setState(() => authed = v));
  }

  @override
  Widget build(BuildContext context) {
    if (authed == null) return const Scaffold(body: Center(child: CircularProgressIndicator()));
    return authed!
        ? HomeShell(onLogout: () async {
            await Api.setToken(null);
            setState(() => authed = false);
          })
        : LoginPage(onDone: () => setState(() => authed = true));
  }
}

// ---------------- login
class LoginPage extends StatefulWidget {
  final VoidCallback onDone;
  const LoginPage({super.key, required this.onDone});
  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  bool reg = false, busy = false;
  final f = {for (final k in ['firstName', 'lastName', 'dob', 'gender', 'phone']) k: TextEditingController()}
    ..addAll({'email': TextEditingController(text: 'asha@example.test'), 'password': TextEditingController(text: 'demo1234')});

  Widget field(String k, String l, {bool obscure = false, TextInputType? type}) => Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: TextField(controller: f[k], obscureText: obscure, keyboardType: type, decoration: InputDecoration(labelText: l, border: const OutlineInputBorder())),
      );

  Future<void> submit() async {
    setState(() => busy = true);
    final body = reg ? {for (final e in f.entries) e.key: e.value.text.trim()} : {'email': f['email']!.text.trim(), 'password': f['password']!.text};
    final ok = await guard(context, () async {
      final r = await Api.post(reg ? '/auth/patient/register' : '/auth/patient/login', body);
      await Api.setToken(r['token']);
    });
    if (ok) widget.onDone();
    if (mounted) setState(() => busy = false);
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        body: SafeArea(
          child: ListView(padding: const EdgeInsets.all(20), children: [
            const SizedBox(height: 40),
            Text('🩺 Offgrid', style: Theme.of(context).textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.bold)),
            const Text('Your medical history. You decide who sees it.', style: TextStyle(color: Colors.black54)),
            const SizedBox(height: 20),
            if (reg) ...[
              field('firstName', 'First name'),
              field('lastName', 'Last name'),
              field('dob', 'Date of birth (YYYY-MM-DD)'),
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: DropdownButtonFormField<String>(
                  initialValue: f['gender']!.text.isEmpty ? null : f['gender']!.text,
                  decoration: const InputDecoration(labelText: 'Gender', border: OutlineInputBorder()),
                  items: const ['Male', 'Female', 'Other'].map((g) => DropdownMenuItem(value: g, child: Text(g))).toList(),
                  onChanged: (v) => f['gender']!.text = v ?? '',
                ),
              ),
              field('phone', 'Phone', type: TextInputType.phone),
            ],
            field('email', 'Email', type: TextInputType.emailAddress),
            field('password', 'Password', obscure: true),
            FilledButton(onPressed: busy ? null : submit, child: Text(busy ? '…' : reg ? 'Create account' : 'Sign in')),
            TextButton(onPressed: () => setState(() => reg = !reg), child: Text(reg ? 'I have an account' : 'Register')),
          ]),
        ),
      );
}

// ---------------- shell with live-ish data (polls every 5s)
class HomeShell extends StatefulWidget {
  final VoidCallback onLogout;
  const HomeShell({super.key, required this.onLogout});
  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int tab = 0;
  List requests = [], records = [], reminders = [];
  Timer? timer;

  Future<void> load() async {
    try {
      final r = await Future.wait([Api.get('/patient/requests'), Api.get('/patient/records'), Api.get('/patient/reminders')]);
      if (mounted) setState(() { requests = r[0]; records = r[1]; reminders = r[2]; });
    } on ApiError catch (e) {
      if (e.unauthorized) widget.onLogout();
    } catch (_) {} // offline: keep last data
  }

  @override
  void initState() {
    super.initState();
    load();
    // ponytail: polling. Use FCM push for background alerts.
    timer = Timer.periodic(const Duration(seconds: 5), (_) => load());
  }

  @override
  void dispose() {
    timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final pending = requests.where((r) => r['status'] == 'PENDING').length;
    final pages = [
      HomePage(pending: pending, goRequests: () => setState(() => tab = 1)),
      RequestsPage(requests: requests, reload: load),
      RecordsPage(records: records, reload: load),
      RemindersPage(items: reminders),
      MePage(onLogout: widget.onLogout),
    ];
    return Scaffold(
      body: SafeArea(child: RefreshIndicator(onRefresh: load, child: pages[tab])),
      bottomNavigationBar: NavigationBar(
        selectedIndex: tab,
        onDestinationSelected: (i) => setState(() => tab = i),
        destinations: [
          const NavigationDestination(icon: Icon(Icons.qr_code), label: 'Home'),
          NavigationDestination(icon: Badge(isLabelVisible: pending > 0, label: Text('$pending'), child: const Icon(Icons.how_to_reg)), label: 'Requests'),
          const NavigationDestination(icon: Icon(Icons.folder_open), label: 'Records'),
          const NavigationDestination(icon: Icon(Icons.event), label: 'Follow-ups'),
          const NavigationDestination(icon: Icon(Icons.person), label: 'Me'),
        ],
      ),
    );
  }
}

Widget page(List<Widget> children) => ListView(padding: const EdgeInsets.all(16), physics: const AlwaysScrollableScrollPhysics(), children: children);
Widget h1(String t) => Padding(padding: const EdgeInsets.only(bottom: 10), child: Text(t, style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold)));
Widget h2(String t) => Padding(padding: const EdgeInsets.only(top: 12, bottom: 6), child: Text(t, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.bold)));
Widget muted(String t) => Text(t, style: const TextStyle(color: Colors.black54, fontSize: 13));

Widget badge(String s) {
  final c = {'VERIFIED': Colors.green.shade700, 'APPROVED': Colors.green.shade700, 'COMPLETED': Colors.green.shade700, 'PENDING': Colors.orange.shade800, 'UPCOMING': Colors.orange.shade800, 'UNVERIFIED': Colors.orange.shade800}[s] ?? Colors.red.shade700;
  return Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
    decoration: BoxDecoration(border: Border.all(color: c), borderRadius: BorderRadius.circular(99)),
    child: Text(s, style: TextStyle(color: c, fontSize: 11, fontWeight: FontWeight.bold)),
  );
}

Widget card(Widget child, {Color? accent}) => Card(
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: BorderSide(color: accent ?? const Color(0xFFDBE5E3), width: accent == null ? 1 : 2)),
      color: Colors.white,
      child: Padding(padding: const EdgeInsets.all(14), child: child),
    );

// ---------------- home: one-time QR
class HomePage extends StatefulWidget {
  final int pending;
  final VoidCallback goRequests;
  const HomePage({super.key, required this.pending, required this.goRequests});
  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  String? token;
  DateTime? expires;
  Timer? t;

  @override
  void dispose() {
    t?.cancel();
    super.dispose();
  }

  Future<void> newQr() async {
    await guard(context, () async {
      final r = await Api.post('/patient/qr');
      setState(() { token = r['token']; expires = DateTime.parse(r['expiresAt']); });
      t?.cancel();
      t = Timer.periodic(const Duration(seconds: 1), (_) {
        if (expires!.isBefore(DateTime.now())) { t?.cancel(); setState(() => token = null); } else { setState(() {}); }
      });
    });
  }

  @override
  Widget build(BuildContext context) {
    final left = expires?.difference(DateTime.now()).inSeconds ?? 0;
    return page([
      h1('My identity'),
      card(Column(children: [
        if (token != null) ...[
          QrImageView(data: 'offgrid:id:$token', size: 220),
          const SizedBox(height: 8),
          muted('One-time code, valid ${left ~/ 60}:${(left % 60).toString().padLeft(2, '0')}. It holds no medical data.'),
        ] else
          muted('Show this at a hospital desk. They scan it, then ask you for approval.'),
        const SizedBox(height: 12),
        FilledButton(onPressed: newQr, child: Text(token == null ? 'Show my QR' : 'New code')),
      ])),
      if (widget.pending > 0)
        card(Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
          Text('${widget.pending} pending request${widget.pending > 1 ? 's' : ''}', style: const TextStyle(fontWeight: FontWeight.bold)),
          FilledButton(onPressed: widget.goRequests, child: const Text('Review')),
        ])),
    ]);
  }
}

// ---------------- requests: approve / narrow / deny
class RequestsPage extends StatelessWidget {
  final List requests;
  final Future<void> Function() reload;
  const RequestsPage({super.key, required this.requests, required this.reload});
  @override
  Widget build(BuildContext context) {
    final pending = requests.where((r) => r['status'] == 'PENDING').toList();
    final rest = requests.where((r) => r['status'] != 'PENDING').toList();
    return page([
      h1('Access requests'),
      if (pending.isEmpty) muted('Nothing waiting for you.'),
      for (final r in pending) PendingCard(key: ValueKey(r['id']), r: r, reload: reload),
      if (rest.isNotEmpty) h2('History'),
      for (final r in rest)
        card(Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [Text(r['requestingHospital']['name'], style: const TextStyle(fontWeight: FontWeight.bold)), badge(r['status'])]),
          muted('${fmtTime(r['createdAt'])} · ${(r['categories'] as List).map((c) => label(c)).join(', ')}'),
        ])),
    ]);
  }
}

class PendingCard extends StatefulWidget {
  final Map r;
  final Future<void> Function() reload;
  const PendingCard({super.key, required this.r, required this.reload});
  @override
  State<PendingCard> createState() => _PendingCardState();
}

class _PendingCardState extends State<PendingCard> {
  late final Set<String> sel = {...(widget.r['categories'] as List).cast<String>()};
  int hours = 24;

  Future<void> act(String path, [Object? body]) async {
    if (await guard(context, () => Api.post('/patient/requests/${widget.r['id']}/$path', body))) await widget.reload();
  }

  @override
  Widget build(BuildContext context) {
    final r = widget.r;
    return card(Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(r['requestingHospital']['name'], style: const TextStyle(fontWeight: FontWeight.bold)),
      muted(r['sourceHospital'] != null ? 'wants records held by ${r['sourceHospital']['name']}' : 'wants access to your records'),
      Padding(padding: const EdgeInsets.symmetric(vertical: 8), child: Text('“${r['reason']}”')),
      for (final c in (r['categories'] as List).cast<String>())
        SwitchListTile(dense: true, contentPadding: EdgeInsets.zero, title: Text(label(c)), value: sel.contains(c), onChanged: (v) => setState(() => v ? sel.add(c) : sel.remove(c))),
      const SizedBox(height: 4),
      muted('Access lasts'),
      Wrap(spacing: 8, children: [
        for (final d in const [(1, '1 hour'), (24, '24 hours'), (168, '7 days')])
          ChoiceChip(label: Text(d.$2), selected: hours == d.$1, onSelected: (_) => setState(() => hours = d.$1)),
      ]),
      const SizedBox(height: 10),
      Row(children: [
        Expanded(child: FilledButton(onPressed: sel.isEmpty ? null : () => act('approve', {'categories': sel.toList(), 'hours': hours}), child: const Text('Approve'))),
        const SizedBox(width: 8),
        Expanded(child: FilledButton(style: FilledButton.styleFrom(backgroundColor: Colors.red.shade700), onPressed: () => act('deny'), child: const Text('Deny'))),
      ]),
    ]));
  }
}

// ---------------- records
class RecordsPage extends StatelessWidget {
  final List records;
  final Future<void> Function() reload;
  const RecordsPage({super.key, required this.records, required this.reload});

  @override
  Widget build(BuildContext context) {
    final verified = records.where((r) => r['status'] == 'VERIFIED').toList();
    final unverified = records.where((r) => r['status'] == 'UNVERIFIED').toList();
    return page([
      Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
        h1('Medical history'),
        OutlinedButton(
          onPressed: () => showModalBottomSheet(context: context, isScrollControlled: true, builder: (_) => UploadSheet(reload: reload)),
          child: const Text('+ Upload'),
        ),
      ]),
      h2('✓ Verified (${verified.length})'),
      for (final r in verified) RecordCard(r: r),
      h2('Unverified (${unverified.length})'),
      for (final r in unverified) RecordCard(r: r),
    ]);
  }
}

class RecordCard extends StatelessWidget {
  final Map r;
  const RecordCard({super.key, required this.r});
  @override
  Widget build(BuildContext context) {
    final v = r['verification'];
    final ok = r['status'] == 'VERIFIED';
    final src = r['source'] == 'PATIENT_UPLOAD' ? 'Patient upload' : '${r['hospital']?['name']}';
    final docs = (r['documents'] as List).map((d) => d['fileName']).join(', ');
    return card(
      accent: ok ? Colors.green.shade600 : Colors.amber.shade700,
      Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [Expanded(child: Text(r['title'], style: const TextStyle(fontWeight: FontWeight.bold))), badge(r['status'])]),
        muted('${label(r['category'])} · ${fmtDate(r['recordDate'])}'),
        if (r['notes'] != null) Padding(padding: const EdgeInsets.symmetric(vertical: 6), child: Text(r['notes'])),
        const SizedBox(height: 4),
        Text(
          'Source: $src${r['author'] != null ? ' · Created by ${r['author']}' : ''}\n'
          '${v != null ? 'Verified by ${v['doctor']} (${v['hospital']}) · ${fmtDate(v['verifiedAt'])} · ${v['signatureValid'] == true ? '✓ signature valid' : '⚠ SIGNATURE INVALID'}' : 'Not verified by a doctor. Not part of your verified history.'}'
          '${docs.isNotEmpty ? '\n📎 $docs' : ''}',
          style: const TextStyle(color: Colors.black54, fontSize: 12),
        ),
      ]),
    );
  }
}

class UploadSheet extends StatefulWidget {
  final Future<void> Function() reload;
  const UploadSheet({super.key, required this.reload});
  @override
  State<UploadSheet> createState() => _UploadSheetState();
}

class _UploadSheetState extends State<UploadSheet> {
  String cat = 'LAB';
  final title = TextEditingController(), notes = TextEditingController();
  final date = TextEditingController(text: DateTime.now().toIso8601String().substring(0, 10));
  PlatformFile? file;

  @override
  Widget build(BuildContext context) => Padding(
        padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(context).viewInsets.bottom + 16),
        child: SingleChildScrollView(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            h1('Upload a record'),
            muted('Your uploads stay unverified until a doctor reviews and signs them.'),
            const SizedBox(height: 10),
            Wrap(spacing: 6, children: [for (final c in recordCats) ChoiceChip(label: Text(label(c)), selected: cat == c, onSelected: (_) => setState(() => cat = c))]),
            const SizedBox(height: 10),
            TextField(controller: title, decoration: const InputDecoration(labelText: 'Title', border: OutlineInputBorder())),
            const SizedBox(height: 10),
            TextField(controller: date, decoration: const InputDecoration(labelText: 'Date (YYYY-MM-DD)', border: OutlineInputBorder())),
            const SizedBox(height: 10),
            TextField(controller: notes, maxLines: 3, decoration: const InputDecoration(labelText: 'Notes', border: OutlineInputBorder())),
            const SizedBox(height: 10),
            OutlinedButton(
              onPressed: () async {
                final r = await FilePicker.pickFiles(type: FileType.custom, allowedExtensions: ['pdf', 'png', 'jpg', 'jpeg']);
                if (r.isNotEmpty) setState(() => file = r.first);
              },
              child: Text(file == null ? 'Attach file (pdf/png/jpg)' : '📎 ${file!.name}'),
            ),
            const SizedBox(height: 10),
            FilledButton(
              onPressed: () async {
                final nav = Navigator.of(context);
                final ok = await guard(context, () => Api.upload('/patient/records', {'category': cat, 'title': title.text, 'recordDate': date.text, if (notes.text.isNotEmpty) 'notes': notes.text}, filePath: file?.path));
                if (ok) {
                  await widget.reload();
                  nav.pop();
                }
              },
              child: const Text('Upload'),
            ),
          ]),
        ),
      );
}

// ---------------- follow-ups
class RemindersPage extends StatelessWidget {
  final List items;
  const RemindersPage({super.key, required this.items});
  @override
  Widget build(BuildContext context) => page([
        h1('Follow-ups'),
        if (items.isEmpty) muted('No follow-ups.'),
        for (final r in items)
          card(Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [Expanded(child: Text(r['reason'], style: const TextStyle(fontWeight: FontWeight.bold))), badge(r['status'])]),
            Text('📅 ${fmtDate(r['followUpDate'])} · ${r['hospital']['name']}'),
            if (r['instructions'] != null) muted(r['instructions']),
          ])),
      ]);
}

// ---------------- me: profile, consents, emergency, history
class MePage extends StatefulWidget {
  final VoidCallback onLogout;
  const MePage({super.key, required this.onLogout});
  @override
  State<MePage> createState() => _MePageState();
}

class _MePageState extends State<MePage> {
  Map? me;
  List consents = [], cards = [], hist = [];
  final ctl = <String, TextEditingController>{};
  String? newCode, newHolder;
  static const keys = {'phone': 'Phone', 'bloodGroup': 'Blood group', 'allergies': 'Severe allergies', 'chronicConditions': 'Chronic conditions', 'emergencyContactName': 'Emergency contact', 'emergencyContactPhone': 'Emergency contact phone'};

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    await guard(context, () async {
      final r = await Future.wait([Api.get('/patient/me'), Api.get('/patient/consents'), Api.get('/patient/emergency-cards'), Api.get('/patient/access-history')]);
      if (!mounted) return;
      setState(() {
        me = r[0];
        consents = r[1];
        cards = r[2];
        hist = r[3];
        for (final k in keys.keys) { ctl[k] = TextEditingController(text: me![k] ?? ''); }
      });
    });
  }

  Future<void> addCard(String kind, String holder) async {
    await guard(context, () async {
      final r = await Api.post('/patient/emergency-cards', {'kind': kind, 'holderName': holder});
      setState(() { newCode = r['code']; newHolder = holder; });
    });
    await load();
  }

  @override
  Widget build(BuildContext context) {
    if (me == null) return const Center(child: CircularProgressIndicator());
    final active = consents.where((c) => c['revokedAt'] == null && DateTime.parse(c['expiresAt']).isAfter(DateTime.now())).toList();
    return page([
      h1('${me!['firstName']} ${me!['lastName']}'),
      card(Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        h2('Personal & emergency info'),
        for (final e in keys.entries) Padding(padding: const EdgeInsets.only(bottom: 10), child: TextField(controller: ctl[e.key], decoration: InputDecoration(labelText: e.value, border: const OutlineInputBorder()))),
        FilledButton(
          onPressed: () async {
            final ok = await guard(context, () => Api.patch('/patient/me', {for (final k in keys.keys) k: ctl[k]!.text.isEmpty ? null : ctl[k]!.text}));
            if (ok && context.mounted) toast(context, 'Saved');
          },
          child: const Text('Save'),
        ),
      ])),
      card(Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        h2('Who can see my data now'),
        if (active.isEmpty) muted('No hospital has active access.'),
        for (final c in active)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Row(children: [
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('${c['hospital']}${c['sourceHospital'] != null ? ' (records from ${c['sourceHospital']})' : ''}', style: const TextStyle(fontWeight: FontWeight.bold)),
                muted('${(c['categories'] as List).map((x) => label(x)).join(', ')} · until ${fmtTime(c['expiresAt'])}'),
              ])),
              FilledButton(style: FilledButton.styleFrom(backgroundColor: Colors.red.shade700), onPressed: () async { await guard(context, () => Api.post('/patient/consents/${c['id']}/revoke')); await load(); }, child: const Text('Revoke')),
            ]),
          ),
      ])),
      card(Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        h2('Emergency access'),
        muted('If you cannot use your phone, a hospital can scan this card or a family code. They see blood group, allergies, conditions and your emergency contact for 1 hour. Every use is logged.'),
        const SizedBox(height: 8),
        for (final c in cards)
          Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
            Text('${c['kind'] == 'CARD' ? '💳' : '👪'} ${c['holderName']}'),
            TextButton(onPressed: () async { await guard(context, () => Api.delete('/patient/emergency-cards/${c['id']}')); await load(); }, child: const Text('Revoke')),
          ]),
        if (newCode != null) Center(child: Column(children: [QrImageView(data: 'offgrid:em:$newCode', size: 180), muted('$newHolder: shown once. Save it now.'), SelectableText(newCode!, style: const TextStyle(fontSize: 12))])),
        const SizedBox(height: 8),
        FilledButton(onPressed: () => addCard('CARD', '${me!['firstName']} ${me!['lastName']}'), child: const Text('New emergency card')),
        OutlinedButton(onPressed: () => askName(context).then((n) { if (n != null && n.isNotEmpty) addCard('FAMILY', n); }), child: const Text('Add family member')),
      ])),
      card(Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        h2('Access history'),
        for (final h in hist) Padding(padding: const EdgeInsets.only(bottom: 6), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text('${h['hospital'] ?? ''}'), muted('${h['action']} · ${fmtTime(h['at'])}')])),
      ])),
      OutlinedButton(onPressed: widget.onLogout, child: const Text('Sign out')),
      const SizedBox(height: 20),
    ]);
  }
}

Future<String?> askName(BuildContext context) {
  final c = TextEditingController();
  return showDialog<String>(
    context: context,
    builder: (_) => AlertDialog(
      title: const Text('Family member name'),
      content: TextField(controller: c, autofocus: true),
      actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')), TextButton(onPressed: () => Navigator.pop(context, c.text.trim()), child: const Text('Add'))],
    ),
  );
}
