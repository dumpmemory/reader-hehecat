const CONTENT_FLAGS: i64 = 4 | 8 | 32 | 64 | 128;
const MODIFIER_FLAGS: i64 = 16 | 256 | 512 | 1024;

pub fn content_type(value: i64) -> Option<i64> {
    if (0..=4).contains(&value) {
        return Some(value);
    }
    if value < 0 || value & !(CONTENT_FLAGS | MODIFIER_FLAGS) != 0 {
        return None;
    }
    match value & CONTENT_FLAGS {
        8 => Some(0),
        32 => Some(1),
        64 => Some(2),
        128 => Some(3),
        4 => Some(4),
        _ => None,
    }
}

pub fn is_local(value: i64) -> bool {
    value >= 8 && value & 256 != 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_book_content_type_legacy_and_flags() {
        for value in 0..=4 {
            assert_eq!(content_type(value), Some(value));
        }
        for (flag, expected) in [(8, 0), (32, 1), (64, 2), (128, 3), (4, 4)] {
            for modifiers in [0, 16, 256, 512, 1024, MODIFIER_FLAGS] {
                assert_eq!(content_type(flag | modifiers), Some(expected));
            }
        }
        for value in [-1, 5, 6, 7, 16, 24 | 32, 256, 512, 1024, 2048, i64::MAX] {
            assert_eq!(content_type(value), None, "invalid type {value}");
        }
        assert!(is_local(8 | 256));
        assert!(!is_local(8 | 16));
        assert!(!is_local(-1));
    }
}
