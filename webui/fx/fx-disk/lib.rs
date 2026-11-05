//! FXDisk WASM Smart Client
//! Chunk-based virtual filesystem with LZ4 decompression and deduplication

use wasm_bindgen::prelude::*;
use std::collections::HashMap;
use lz4_flex::{compress_prepend_size, decompress_size_prepended};

/// Chunk size for deduplication (4KB)
const CHUNK_SIZE: usize = 4096;

/// File entry metadata
#[derive(Clone)]
struct FileEntry {
    chunks: Vec<String>,
    size: usize,
    compression: String,
    content_type: String,
}

/// Chunk entry with reference counting
struct ChunkEntry {
    data: Vec<u8>,
    ref_count: u32,
}

/// Virtual filesystem with chunk-based deduplication
#[wasm_bindgen]
pub struct FxDiskVFS {
    files: HashMap<String, FileEntry>,
    chunks: HashMap<String, ChunkEntry>,
    dedup_count: u32,
}

#[wasm_bindgen]
impl FxDiskVFS {
    /// Create new virtual filesystem
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        console_error_panic_hook::set_once();
        Self {
            files: HashMap::new(),
            chunks: HashMap::new(),
            dedup_count: 0,
        }
    }

    /// Add a chunk by hash, returns true if new
    #[wasm_bindgen]
    pub fn add_chunk(&mut self, hash: &str, data: &[u8]) -> bool {
        if let Some(entry) = self.chunks.get_mut(hash) {
            entry.ref_count += 1;
            self.dedup_count += 1;
            false
        } else {
            self.chunks.insert(hash.to_string(), ChunkEntry {
                data: data.to_vec(),
                ref_count: 1,
            });
            true
        }
    }

    /// Get chunk by hash
    #[wasm_bindgen]
    pub fn get_chunk(&self, hash: &str) -> Option<Vec<u8>> {
        self.chunks.get(hash).map(|e| e.data.clone())
    }

    /// Check if chunk exists
    #[wasm_bindgen]
    pub fn has_chunk(&self, hash: &str) -> bool {
        self.chunks.contains_key(hash)
    }

    /// Add file with chunk references
    #[wasm_bindgen]
    pub fn add_file(&mut self, path: &str, chunks: Vec<JsValue>, size: usize, compression: &str) {
        let chunk_hashes: Vec<String> = chunks
            .into_iter()
            .filter_map(|v| v.as_string())
            .collect();
        
        self.files.insert(path.to_string(), FileEntry {
            chunks: chunk_hashes,
            size,
            compression: compression.to_string(),
            content_type: Self::detect_content_type(path),
        });
    }

    /// Read file, assembling chunks and decompressing
    #[wasm_bindgen]
    pub fn read_file(&self, path: &str) -> Result<Vec<u8>, JsValue> {
        let entry = self.files.get(path)
            .ok_or_else(|| JsValue::from_str(&format!("File not found: {}", path)))?;

        // Assemble chunks
        let mut data = Vec::with_capacity(entry.size);
        for hash in &entry.chunks {
            let chunk = self.chunks.get(hash)
                .ok_or_else(|| JsValue::from_str(&format!("Missing chunk: {}", hash)))?;
            data.extend_from_slice(&chunk.data);
        }

        // Decompress if needed
        if entry.compression == "lz4" {
            data = decompress_size_prepended(&data)
                .map_err(|e| JsValue::from_str(&format!("LZ4 decompress error: {}", e)))?;
        }

        Ok(data)
    }

    /// Read file as UTF-8 string
    #[wasm_bindgen]
    pub fn read_file_string(&self, path: &str) -> Result<String, JsValue> {
        let bytes = self.read_file(path)?;
        String::from_utf8(bytes)
            .map_err(|e| JsValue::from_str(&format!("UTF-8 error: {}", e)))
    }

    /// Check if file exists
    #[wasm_bindgen]
    pub fn exists(&self, path: &str) -> bool {
        self.files.contains_key(path)
    }

    /// List all files
    #[wasm_bindgen]
    pub fn list_files(&self) -> Vec<JsValue> {
        self.files.keys()
            .map(|k| JsValue::from_str(k))
            .collect()
    }

    /// Get file count
    #[wasm_bindgen]
    pub fn file_count(&self) -> usize {
        self.files.len()
    }

    /// Get chunk count
    #[wasm_bindgen]
    pub fn chunk_count(&self) -> usize {
        self.chunks.len()
    }

    /// Get dedup count
    #[wasm_bindgen]
    pub fn dedup_count(&self) -> u32 {
        self.dedup_count
    }

    /// Add file with automatic chunking and compression
    #[wasm_bindgen]
    pub fn add_file_auto(&mut self, path: &str, content: &[u8], compress: bool) -> Result<(), JsValue> {
        let (data, compression) = if compress && content.len() > 256 {
            (compress_prepend_size(content), "lz4".to_string())
        } else {
            (content.to_vec(), "none".to_string())
        };

        // Split into chunks and compute hashes
        let mut chunk_hashes = Vec::new();
        for chunk in data.chunks(CHUNK_SIZE) {
            let hash = Self::compute_hash(chunk);
            self.add_chunk(&hash, chunk);
            chunk_hashes.push(hash);
        }

        self.files.insert(path.to_string(), FileEntry {
            chunks: chunk_hashes,
            size: content.len(),
            compression,
            content_type: Self::detect_content_type(path),
        });

        Ok(())
    }

    /// Export as bundle
    #[wasm_bindgen]
    pub fn export_bundle(&self) -> Result<Vec<u8>, JsValue> {
        // Format: [manifestLen:u32][manifest:JSON][chunkCount:u32][chunks...]
        // Chunk: [hashLen:u8][hash][dataLen:u32][data]
        
        let manifest = self.serialize_manifest()
            .map_err(|e| JsValue::from_str(&e))?;
        
        let mut output = Vec::new();
        
        // Manifest length and data
        output.extend_from_slice(&(manifest.len() as u32).to_le_bytes());
        output.extend_from_slice(manifest.as_bytes());
        
        // Chunk count
        output.extend_from_slice(&(self.chunks.len() as u32).to_le_bytes());
        
        // Chunks
        for (hash, entry) in &self.chunks {
            let hash_bytes = hash.as_bytes();
            output.push(hash_bytes.len() as u8);
            output.extend_from_slice(hash_bytes);
            output.extend_from_slice(&(entry.data.len() as u32).to_le_bytes());
            output.extend_from_slice(&entry.data);
        }
        
        Ok(output)
    }

    /// Import from bundle
    #[wasm_bindgen]
    pub fn import_bundle(&mut self, data: &[u8]) -> Result<usize, JsValue> {
        if data.len() < 4 {
            return Err(JsValue::from_str("Invalid bundle: too short"));
        }

        let mut pos = 0;
        
        // Read manifest
        let manifest_len = u32::from_le_bytes(data[pos..pos+4].try_into().unwrap()) as usize;
        pos += 4;
        
        if pos + manifest_len > data.len() {
            return Err(JsValue::from_str("Invalid bundle: truncated manifest"));
        }
        
        let manifest_str = std::str::from_utf8(&data[pos..pos+manifest_len])
            .map_err(|_| JsValue::from_str("Invalid bundle: bad manifest UTF-8"))?;
        pos += manifest_len;
        
        self.deserialize_manifest(manifest_str)
            .map_err(|e| JsValue::from_str(&e))?;
        
        // Read chunks
        if pos + 4 > data.len() {
            return Err(JsValue::from_str("Invalid bundle: no chunk count"));
        }
        
        let chunk_count = u32::from_le_bytes(data[pos..pos+4].try_into().unwrap()) as usize;
        pos += 4;
        
        for _ in 0..chunk_count {
            if pos >= data.len() {
                return Err(JsValue::from_str("Invalid bundle: truncated chunks"));
            }
            
            let hash_len = data[pos] as usize;
            pos += 1;
            
            if pos + hash_len > data.len() {
                return Err(JsValue::from_str("Invalid bundle: truncated hash"));
            }
            
            let hash = std::str::from_utf8(&data[pos..pos+hash_len])
                .map_err(|_| JsValue::from_str("Invalid bundle: bad hash UTF-8"))?
                .to_string();
            pos += hash_len;
            
            if pos + 4 > data.len() {
                return Err(JsValue::from_str("Invalid bundle: truncated data length"));
            }
            
            let data_len = u32::from_le_bytes(data[pos..pos+4].try_into().unwrap()) as usize;
            pos += 4;
            
            if pos + data_len > data.len() {
                return Err(JsValue::from_str("Invalid bundle: truncated data"));
            }
            
            let chunk_data = data[pos..pos+data_len].to_vec();
            pos += data_len;
            
            if !self.chunks.contains_key(&hash) {
                self.chunks.insert(hash, ChunkEntry {
                    data: chunk_data,
                    ref_count: 1,
                });
            }
        }
        
        Ok(self.files.len())
    }

    /// Get stats as JSON
    #[wasm_bindgen]
    pub fn get_stats(&self) -> String {
        let total_size: usize = self.files.values().map(|f| f.size).sum();
        let chunk_bytes: usize = self.chunks.values().map(|c| c.data.len()).sum();
        
        format!(
            r#"{{"files":{},"chunks":{},"dedups":{},"totalSize":{},"compressedSize":{}}}"#,
            self.files.len(),
            self.chunks.len(),
            self.dedup_count,
            total_size,
            chunk_bytes
        )
    }

    // Private helpers
    fn compute_hash(data: &[u8]) -> String {
        // FNV-1a 64-bit hash
        let mut h1: u64 = 0x811c9dc5;
        let mut h2: u64 = 0x811c9dc5;
        
        for &b in data {
            h1 ^= b as u64;
            h1 = h1.wrapping_mul(0x01000193);
            h2 ^= b as u64;
            h2 = h2.wrapping_mul(0x01000193);
            h2 = h2.rotate_left(5);
        }
        
        format!("{:08x}{:08x}", h1 as u32, h2 as u32)
    }

    fn detect_content_type(path: &str) -> String {
        match path.rsplit('.').next() {
            Some("ts") | Some("tsx") => "application/typescript",
            Some("js") | Some("jsx") | Some("mjs") => "application/javascript",
            Some("json") => "application/json",
            Some("html") => "text/html",
            Some("css") => "text/css",
            Some("md") => "text/markdown",
            Some("fxc") => "application/fx-component",
            _ => "application/octet-stream",
        }.to_string()
    }

    fn serialize_manifest(&self) -> Result<String, String> {
        // Simple JSON serialization
        let mut entries = Vec::new();
        
        for (path, entry) in &self.files {
            let chunks_json: Vec<String> = entry.chunks.iter()
                .map(|h| format!("\"{}\"", h))
                .collect();
            
            entries.push(format!(
                r#"{{"path":"{}","chunks":[{}],"size":{},"compression":"{}","contentType":"{}"}}"#,
                path,
                chunks_json.join(","),
                entry.size,
                entry.compression,
                entry.content_type
            ));
        }
        
        Ok(format!(
            r#"{{"version":"2.0.0","files":[{}]}}"#,
            entries.join(",")
        ))
    }

    fn deserialize_manifest(&mut self, json: &str) -> Result<(), String> {
        // Simple JSON parsing (production would use serde)
        // This is a minimal parser for the expected format
        
        // Extract files array
        let files_start = json.find("\"files\":[")
            .ok_or("Invalid manifest: no files array")?;
        let files_content = &json[files_start + 9..];
        
        // Parse each file entry
        let mut depth = 1;
        let mut entry_start = 0;
        let mut in_string = false;
        let mut escape = false;
        
        for (i, c) in files_content.chars().enumerate() {
            if escape {
                escape = false;
                continue;
            }
            
            match c {
                '\\' => escape = true,
                '"' => in_string = !in_string,
                '{' if !in_string => {
                    if depth == 1 {
                        entry_start = i;
                    }
                    depth += 1;
                }
                '}' if !in_string => {
                    depth -= 1;
                    if depth == 1 {
                        let entry_json = &files_content[entry_start..=i];
                        self.parse_file_entry(entry_json)?;
                    }
                    if depth == 0 {
                        break;
                    }
                }
                _ => {}
            }
        }
        
        Ok(())
    }

    fn parse_file_entry(&mut self, json: &str) -> Result<(), String> {
        // Extract path
        let path = Self::extract_string(json, "path")
            .ok_or("Invalid entry: no path")?;
        
        // Extract chunks array
        let chunks_start = json.find("\"chunks\":[")
            .ok_or("Invalid entry: no chunks")?;
        let chunks_end = json[chunks_start..].find(']')
            .ok_or("Invalid entry: unclosed chunks")?;
        let chunks_str = &json[chunks_start + 10..chunks_start + chunks_end];
        
        let chunks: Vec<String> = chunks_str
            .split(',')
            .filter_map(|s| {
                let trimmed = s.trim().trim_matches('"');
                if trimmed.is_empty() { None } else { Some(trimmed.to_string()) }
            })
            .collect();
        
        // Extract other fields
        let size = Self::extract_number(json, "size").unwrap_or(0);
        let compression = Self::extract_string(json, "compression")
            .unwrap_or_else(|| "none".to_string());
        let content_type = Self::extract_string(json, "contentType")
            .unwrap_or_else(|| "application/octet-stream".to_string());
        
        self.files.insert(path, FileEntry {
            chunks,
            size,
            compression,
            content_type,
        });
        
        Ok(())
    }

    fn extract_string(json: &str, key: &str) -> Option<String> {
        let pattern = format!("\"{}\":\"", key);
        let start = json.find(&pattern)? + pattern.len();
        let end = json[start..].find('"')?;
        Some(json[start..start + end].to_string())
    }

    fn extract_number(json: &str, key: &str) -> Option<usize> {
        let pattern = format!("\"{}\":", key);
        let start = json.find(&pattern)? + pattern.len();
        let rest = json[start..].trim_start();
        let end = rest.find(|c: char| !c.is_numeric()).unwrap_or(rest.len());
        rest[..end].parse().ok()
    }
}

impl Default for FxDiskVFS {
    fn default() -> Self {
        Self::new()
    }
}

/// Initialize panic hook
#[wasm_bindgen(start)]
pub fn init() {
    console_error_panic_hook::set_once();
}
