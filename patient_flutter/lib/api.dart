import 'dart:convert';
import 'dart:io' show Platform;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';

// Android emulator reaches the host at 10.0.2.2, iOS simulator at localhost. Real phone:
//   flutter run --dart-define=API_URL=http://<computer LAN IP>:4000
final base = const String.fromEnvironment('API_URL').isNotEmpty
    ? const String.fromEnvironment('API_URL')
    : Platform.isAndroid ? 'http://10.0.2.2:4000' : 'http://localhost:4000';

class ApiError implements Exception {
  final String message;
  final bool unauthorized;
  ApiError(this.message, {this.unauthorized = false});
  @override
  String toString() => message;
}

class Api {
  static const _store = FlutterSecureStorage();
  static String? _token;

  static Future<bool> load() async => (_token = await _store.read(key: 'og_token')) != null;
  static Future<void> setToken(String? t) async {
    _token = t;
    t == null ? await _store.delete(key: 'og_token') : await _store.write(key: 'og_token', value: t);
  }

  static Map<String, String> get _headers => {
        'content-type': 'application/json',
        if (_token != null) 'authorization': 'Bearer $_token',
      };

  static dynamic _decode(http.Response r) {
    final body = r.body.isEmpty ? null : jsonDecode(r.body);
    if (r.statusCode >= 400) {
      throw ApiError(body is Map && body['error'] != null ? '${body['error']}' : 'HTTP ${r.statusCode}',
          unauthorized: r.statusCode == 401 && _token != null);
    }
    return body;
  }

  static Future<dynamic> get(String path) async => _decode(await http.get(Uri.parse('$base/api$path'), headers: _headers));
  static Future<dynamic> post(String path, [Object? body]) async =>
      _decode(await http.post(Uri.parse('$base/api$path'), headers: _headers, body: body == null ? null : jsonEncode(body)));
  static Future<dynamic> patch(String path, Object body) async =>
      _decode(await http.patch(Uri.parse('$base/api$path'), headers: _headers, body: jsonEncode(body)));
  static Future<dynamic> delete(String path) async => _decode(await http.delete(Uri.parse('$base/api$path'), headers: _headers));

  static Future<dynamic> upload(String path, Map<String, String> fields, {String? filePath}) async {
    final req = http.MultipartRequest('POST', Uri.parse('$base/api$path'))
      ..headers['authorization'] = 'Bearer $_token'
      ..fields.addAll(fields);
    if (filePath != null) {
      final ext = filePath.split('.').last.toLowerCase();
      final mime = {'pdf': 'application/pdf', 'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg'}[ext] ?? 'application/octet-stream';
      req.files.add(await http.MultipartFile.fromPath('file', filePath, contentType: MediaType.parse(mime)));
    }
    return _decode(await http.Response.fromStream(await req.send()));
  }
}
